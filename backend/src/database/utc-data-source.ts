import { DataSource } from 'typeorm';

const SET_UTC = "SET time_zone = '+00:00'";

interface MysqlConnection {
  query(sql: string): void;
}
interface MysqlPool {
  on(
    event: 'connection',
    listener: (connection: MysqlConnection) => void,
  ): void;
  _allConnections?: { toArray(): MysqlConnection[] };
}

/**
 * A DataSource whose MySQL sessions all run in UTC.
 *
 * The app reads and writes dates as UTC (timezone: 'Z'), but columns filled by MySQL itself
 * (created_at, updated_at via CURRENT_TIMESTAMP) use the session time zone, which defaults to the
 * server's local time (EAT on a Kenyan machine). Forcing UTC keeps both kinds of dates consistent
 * on any server.
 */
export class UtcDataSource extends DataSource {
  override async initialize(): Promise<this> {
    await super.initialize();
    const pool = (this.driver as unknown as { pool?: MysqlPool }).pool;
    if (pool) {
      pool.on('connection', (connection) => connection.query(SET_UTC));
      // Connections opened while initialising already exist; set them too.
      for (const connection of pool._allConnections?.toArray() ?? [])
        connection.query(SET_UTC);
    }
    return this;
  }
}
