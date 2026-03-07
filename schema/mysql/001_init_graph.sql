CREATE TABLE IF NOT EXISTS nodes (
    id VARCHAR(36) NOT NULL COMMENT 'UUID primary key used as the stable node identifier across distributed storage.',
    type VARCHAR(64) NOT NULL COMMENT 'Node category used by clients and downstream services, such as text, image, or person.',
    content TEXT NOT NULL COMMENT 'Core summary content rendered as the primary node label or payload excerpt.',
    properties JSON NOT NULL COMMENT 'Extensible JSON document for coordinates, visual style, and domain-specific attributes.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Creation timestamp tracked for auditing and synchronization.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Last modification timestamp tracked for auditing and synchronization.',
    deleted_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Soft-delete timestamp. NULL means the node remains active.',
    PRIMARY KEY (id),
    KEY idx_nodes_type (type),
    KEY idx_nodes_deleted_at (deleted_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Graph node records for the mesh-style mind map domain.';

CREATE TABLE IF NOT EXISTS edges (
    id VARCHAR(36) NOT NULL COMMENT 'UUID primary key used as the stable edge identifier across distributed storage.',
    source_id VARCHAR(36) NOT NULL COMMENT 'UUID of the source node for outgoing traversal and rendering.',
    target_id VARCHAR(36) NOT NULL COMMENT 'UUID of the target node for incoming traversal and rendering.',
    relation_type VARCHAR(64) NOT NULL COMMENT 'Semantic relation label such as PARENT_CHILD, SPOUSE, or REFERENCE.',
    weight INT NOT NULL DEFAULT 1 COMMENT 'Relation weight reserved for layout ranking and traversal heuristics.',
    properties JSON NOT NULL COMMENT 'Extensible JSON document for line style, arrow direction, and domain-specific edge attributes.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Creation timestamp tracked for auditing and synchronization.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Last modification timestamp tracked for auditing and synchronization.',
    deleted_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Soft-delete timestamp. NULL means the edge remains active.',
    PRIMARY KEY (id),
    KEY idx_edges_source_relation (source_id, relation_type),
    KEY idx_edges_target_relation (target_id, relation_type),
    KEY idx_edges_deleted_at (deleted_at),
    CONSTRAINT fk_edges_source_node
        FOREIGN KEY (source_id) REFERENCES nodes (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_edges_target_node
        FOREIGN KEY (target_id) REFERENCES nodes (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Directed graph edge records connecting two node UUIDs.';
