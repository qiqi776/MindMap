package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"
	httpapi "treemindmap/internal/transport/httpapi"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultMySQLDSN  = "root:123456@tcp(127.0.0.1:3306)/treemindmap?charset=utf8mb4&parseTime=True&loc=Local"
	defaultSQLiteDSN = "file:treemindmap.sqlite?_loc=auto"
	defaultDBDriver  = "sqlite"
	defaultHTTPPort  = "8080"
	shutdownTimeout  = 10 * time.Second
	connMaxLifetime  = time.Hour
	maxQueryDepth    = 6
	envFilePath      = ".env"

	defaultFocusNodeID    = "11111111-1111-1111-1111-111111111111"
	defaultFrontendNodeID = "22222222-2222-2222-2222-222222222222"
	defaultBackendNodeID  = "33333333-3333-3333-3333-333333333333"
	defaultFrontendEdgeID = "44444444-4444-4444-4444-444444444444"
	defaultBackendEdgeID  = "55555555-5555-5555-5555-555555555555"
)

func main() {
	logger := log.New(os.Stdout, "treemindmap ", log.LstdFlags|log.LUTC)

	if err := godotenv.Load(envFilePath); err != nil {
		logger.Printf("could not load %s: %v", envFilePath, err)
	}

	databaseDriver, databaseDSN := resolveDatabaseConfig(logger)

	httpPort := os.Getenv("PORT")
	if httpPort == "" {
		httpPort = defaultHTTPPort
	}

	database, err := openDatabase(databaseDriver, databaseDSN)
	if err != nil {
		logger.Fatalf("failed to connect database: %v", err)
	}

	sqlDatabase, err := database.DB()
	if err != nil {
		logger.Fatalf("failed to access sql.DB: %v", err)
	}

	configureConnectionPool(databaseDriver, sqlDatabase)

	if err := database.AutoMigrate(&model.Node{}, &model.Edge{}); err != nil {
		logger.Fatalf("failed to auto migrate schema: %v", err)
	}

	if err := bootstrapDefaultGraph(context.Background(), database, logger); err != nil {
		logger.Fatalf("failed to bootstrap default graph: %v", err)
	}

	repository := model.NewGormRepository(database)
	queryService := appservice.NewGraphQueryService(repository)
	mutationService := appservice.NewGraphMutationService(repository)
	controller := httpapi.NewGraphController(queryService, mutationService, maxQueryDepth)

	engine := gin.New()
	engine.Use(gin.Logger())
	httpapi.RegisterGraphRoutes(engine, controller, logger)

	server := &http.Server{
		Addr:              ":" + httpPort,
		Handler:           engine,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Printf("http server listening on :%s", httpPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("failed to start http server: %v", err)
		}
	}()

	signalContext, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	<-signalContext.Done()
	logger.Printf("shutdown signal received")

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelShutdown()

	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Fatalf("failed to gracefully shut down http server: %v", err)
	}

	logger.Printf("http server stopped")
}

func resolveDatabaseConfig(logger *log.Logger) (string, string) {
	databaseDriver := strings.ToLower(strings.TrimSpace(os.Getenv("DB_DRIVER")))
	databaseDSN := strings.TrimSpace(os.Getenv("DB_DSN"))

	if databaseDriver == "" {
		switch {
		case databaseDSN == "":
			databaseDriver = defaultDBDriver
			databaseDSN = defaultSQLiteDSN
			if logger != nil {
				logger.Printf("DB_DRIVER and DB_DSN are empty, using default sqlite database %s", databaseDSN)
			}
		case looksLikeSQLiteDSN(databaseDSN):
			databaseDriver = "sqlite"
		default:
			databaseDriver = "mysql"
		}
	}

	if databaseDSN == "" {
		switch databaseDriver {
		case "mysql":
			databaseDSN = defaultMySQLDSN
			if logger != nil {
				logger.Printf("DB_DSN is empty, using default mysql DSN")
			}
		case "sqlite":
			databaseDSN = defaultSQLiteDSN
			if logger != nil {
				logger.Printf("DB_DSN is empty, using default sqlite database %s", databaseDSN)
			}
		default:
			if logger != nil {
				logger.Printf("DB_DSN is empty for unsupported DB_DRIVER=%s", databaseDriver)
			}
		}
	}

	return databaseDriver, databaseDSN
}

func looksLikeSQLiteDSN(databaseDSN string) bool {
	lowerDSN := strings.ToLower(strings.TrimSpace(databaseDSN))
	return strings.HasPrefix(lowerDSN, "file:") || strings.HasSuffix(lowerDSN, ".db") || strings.HasSuffix(lowerDSN, ".sqlite") || strings.HasSuffix(lowerDSN, ".sqlite3")
}

func openDatabase(databaseDriver string, databaseDSN string) (*gorm.DB, error) {
	switch databaseDriver {
	case "mysql":
		return gorm.Open(mysql.Open(databaseDSN), &gorm.Config{})
	case "sqlite":
		return gorm.Open(sqlite.Open(databaseDSN), &gorm.Config{})
	default:
		return nil, errors.New("unsupported DB_DRIVER: " + databaseDriver)
	}
}

func configureConnectionPool(databaseDriver string, sqlDatabase *sql.DB) {
	if sqlDatabase == nil {
		return
	}

	switch databaseDriver {
	case "sqlite":
		sqlDatabase.SetMaxIdleConns(1)
		sqlDatabase.SetMaxOpenConns(1)
	case "mysql":
		sqlDatabase.SetMaxIdleConns(10)
		sqlDatabase.SetMaxOpenConns(100)
		sqlDatabase.SetConnMaxLifetime(connMaxLifetime)
	}
}

func bootstrapDefaultGraph(ctx context.Context, database *gorm.DB, logger *log.Logger) error {
	if database == nil {
		return errors.New("nil database")
	}

	var focusNode model.Node
	if err := database.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", defaultFocusNodeID).
		First(&focusNode).Error; err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	seedNodes := []model.Node{
		{
			ID:         defaultFocusNodeID,
			Type:       "text",
			Content:    "TreeMindMap Demo",
			Properties: model.JSONDocument(`{"x":0,"y":0}`),
		},
		{
			ID:         defaultFrontendNodeID,
			Type:       "text",
			Content:    "Focus Switching Frontend",
			Properties: model.JSONDocument(`{"x":180,"y":-80}`),
		},
		{
			ID:         defaultBackendNodeID,
			Type:       "text",
			Content:    "Graph Service Backend",
			Properties: model.JSONDocument(`{"x":180,"y":80}`),
		},
	}

	seedEdges := []model.Edge{
		{
			ID:           defaultFrontendEdgeID,
			SourceID:     defaultFocusNodeID,
			TargetID:     defaultFrontendNodeID,
			RelationType: "REFERENCE",
			Weight:       1,
			Properties:   model.JSONDocument(`{}`),
		},
		{
			ID:           defaultBackendEdgeID,
			SourceID:     defaultFocusNodeID,
			TargetID:     defaultBackendNodeID,
			RelationType: "REFERENCE",
			Weight:       1,
			Properties:   model.JSONDocument(`{}`),
		},
	}

	if err := database.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&seedNodes).Error; err != nil {
		return err
	}

	if err := database.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&seedEdges).Error; err != nil {
		return err
	}

	if logger != nil {
		logger.Printf("seeded default graph with focus node %s", defaultFocusNodeID)
	}

	return nil
}
