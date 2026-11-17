export function createFileMetadataRepository(db) {
  return {
    async insert(file) {
      await db.prepare('INSERT INTO file_metadata (id,bucket,object_key,name,mime_type,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(file.id, file.bucket, file.key, file.name, file.mimeType, file.size, file.sha256, new Date().toISOString());
      return file.id;
    },
    async get(id) {
      const row = await db.prepare('SELECT id,bucket,object_key,name,mime_type,size_bytes,sha256 FROM file_metadata WHERE id=?').get(id);
      return row ? { id: row.id, bucket: row.bucket, key: row.object_key, name: row.name, mimeType: row.mime_type, size: Number(row.size_bytes), sha256: row.sha256 } : null;
    },
  };
}
