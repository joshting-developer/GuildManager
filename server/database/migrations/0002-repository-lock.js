export const repositoryLock = {
  id: '0002_repository_lock',
  statements: [
    'CREATE TABLE repository_write_lock (id TINYINT PRIMARY KEY CHECK(id=1)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin',
    'INSERT INTO repository_write_lock (id) VALUES (1)',
  ],
};
