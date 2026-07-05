import { Pool } from 'pg';
import neo4j from 'neo4j-driver';
import { config } from './index.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

// PostgreSQL Connection (AST Document Store)
export const pgPool = new Pool(config.postgres);

// Neo4j Connection (Semantic Knowledge Graph)
export const neo4jDriver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

installShutdownSignalHandlers();
shutdownCoordinator.register('database.clients', 20, async () => {
  await Promise.all([
    pgPool.end(),
    neo4jDriver.close(),
  ]);
});
