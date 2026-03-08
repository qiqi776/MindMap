package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"
	httpapi "treemindmap/internal/transport/httpapi"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

const (
	defaultDBDSN      = "root:123456@tcp(127.0.0.1:3306)/treemindmap?charset=utf8mb4&parseTime=True&loc=Local"
	defaultHTTPPort   = "8080"
	shutdownTimeout   = 10 * time.Second
	connMaxLifetime   = time.Hour
	maxIdleConnsCount = 10
	maxOpenConnsCount = 100
	maxQueryDepth     = 6
	envFilePath       = ".env"
)

func main() {
	logger := log.New(os.Stdout, "treemindmap ", log.LstdFlags|log.LUTC)

	if err := godotenv.Load(envFilePath); err != nil {
		logger.Printf("could not load %s: %v", envFilePath, err)
	}

	databaseDSN := os.Getenv("DB_DSN")
	if databaseDSN == "" {
		databaseDSN = defaultDBDSN
		logger.Printf("DB_DSN is empty, using default local DSN")
	}

	httpPort := os.Getenv("PORT")
	if httpPort == "" {
		httpPort = defaultHTTPPort
	}

	database, err := gorm.Open(mysql.Open(databaseDSN), &gorm.Config{})
	if err != nil {
		logger.Fatalf("failed to connect database: %v", err)
	}

	sqlDatabase, err := database.DB()
	if err != nil {
		logger.Fatalf("failed to access sql.DB: %v", err)
	}

	sqlDatabase.SetMaxIdleConns(maxIdleConnsCount)
	sqlDatabase.SetMaxOpenConns(maxOpenConnsCount)
	sqlDatabase.SetConnMaxLifetime(connMaxLifetime)

	if err := database.AutoMigrate(&model.Node{}, &model.Edge{}); err != nil {
		logger.Fatalf("failed to auto migrate schema: %v", err)
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
