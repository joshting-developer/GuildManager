import assert from 'node:assert/strict';
import { repositoryDatabase } from '../tests/helpers/mysql-repository.js';
import { BATTLE_COLUMNS } from '../src/domain/battle-records.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { taipeiToday } from '../src/domain/battle-events.js';
import { fillBattlePlayerStats } from '../server/database/migrations/0006-battle-player-stats.js';

// Called only after the test helper has acquired an empty, dedicated MySQL schema.
export async function createBenchmarkFixture(repo, distribution) {
  assert.ok(['normal', 'concentrated'].includes(distribution));
  const db = repositoryDatabase(repo);
  await repo.updatePlatformSettings({ name: 'Benchmark', revision: 1,
    icon: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1kAAAAASUVORK5CYII=' } });
  const event = await repo.createEvent({ title: 'Benchmark', type: 'scrimmage', dates: [taipeiToday()], requestId: 'bench-event' });
  const header = BATTLE_COLUMNS.map(([name]) => name).join(',');
  const players = side => Array.from({ length: 60 }, (_, i) => `Bench${side}${i},素問,1,2,3,400,0,500,600,1,2,0`).join('\r\n');
  const csvText = `${header}\r\n${players('red')}\r\n${header}\r\n${players('blue')}\r\n`;
  const saved = await repo.saveBattleRecords({ requestId: 'bench-upload', records: [{ eventId: event.id, roundNumber: 1,
    filename: 'bench.csv', csvText, datetime: taipeiToday(), redTeam: 'Bench', blueTeam: 'Opponent', type: 'scrimmage' }] });
  const battle = saved.records[0];
  const [source] = await db.query('SELECT upload_id FROM battle_records WHERE id=?', [battle.id]);
  let members = 0, battles = 1, events = 1, guests = 0, cancelled = 0, versions = 0, videos = 0;
  return {
    eventId: event.id, battleId: battle.id,
    async grow({ size, eventCount, guestCount, versionCount, videoCount }) {
      const targetVideos = distribution === 'normal' ? Math.min(videoCount, 20) : videoCount;
      const targetVersions = distribution === 'normal' ? Math.min(versionCount, 20) : versionCount;
      for (; members < size; members++) await db.query(`INSERT INTO members
        (uid,name,primary_profession_id,primary_profession,secondary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision)
        VALUES (?, ?,1,'素問','',1,1,'2026-01-01','2026-01-01',1)`, [`BENCH-${members}`, members === 0 ? 'Benchred0' : `Bench${members}`]);
      for (; events < eventCount; events++) {
        const id = `event-${String(events).padStart(6,'0')}`;
        await db.query(`INSERT INTO scheduled_events(id,title,type,request_id,created_at,updated_at)
          VALUES (?,?,?,?,'2020-01-01','2020-01-01')`, [id, id, events % 5 === 0 ? 'activity' : 'scrimmage', id]);
        await db.query("INSERT INTO event_dates(event_id,date) VALUES (?,'2020-01-01')", [id]);
      }
      for (; battles < size; battles++) {
        const uploadId = battles === 1 ? source.upload_id : `upload-${Math.floor(battles / 2)}`;
        if (battles % 2 === 0) await db.query("INSERT INTO battle_uploads(id,request_id,input_hash,created_at) VALUES (?,?,?,'2026-01-01')", [uploadId, uploadId, uploadId]);
        // Normal data spreads batches over events; concentrated data shares one event.
        const battleEvents = Array.from({ length: eventCount - 1 }, (_, i) => i + 1).filter(i => i % 5 !== 0);
        const battleEvent = distribution === 'concentrated' || battles < 2 ? event.id : `event-${String(battleEvents[(Math.floor(battles / 2) - 1) % battleEvents.length]).padStart(6,'0')}`;
        // Pick a battle type even when the surrounding event catalogue contains general activities.
        const [candidate] = await db.query('SELECT type FROM scheduled_events WHERE id=?', [battleEvent]);
        const selectedEvent = candidate.type === 'activity' ? event.id : battleEvent;
        await db.query(`INSERT INTO battle_records
          (id,upload_id,event_id,event_snapshot_json,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,content_hash,created_at,round_number,our_side,is_internal,csv_file_id)
          SELECT ?,?,?,NULL,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,?,created_at,?,our_side,is_internal,csv_file_id FROM battle_records WHERE id=?`,
        [`battle-${battles}`, uploadId, selectedEvent, `bench-hash-${battles}`, distribution === 'concentrated' && battles >= 2 ? null : battles % 2 + 1, battle.id]);
      }
      await db.query("INSERT IGNORE INTO battle_player_links(record_id,player_index,member_uid) SELECT id,0,'BENCH-0' FROM battle_records");
      await db.query(fillBattlePlayerStats);
      for (; guests < guestCount; guests++) await db.query(`INSERT INTO event_registrations
        (id,event_id,name,profession_id,note,active,revision,request_id,created_at,updated_at)
        VALUES (?,?,?,1,'',1,1,?,'2026-01-01','2026-01-01')`, [`guest-${guests}`, event.id, `Guest${guests}`, `guest-${guests}`]);
      const targetCancelled = distribution === 'normal' ? guestCount : guestCount * 5;
      for (; cancelled < targetCancelled; cancelled++) await db.query(`INSERT INTO event_registrations
        (id,event_id,name,profession_id,note,active,revision,request_id,created_at,updated_at)
        VALUES (?,?,?,1,'',0,1,?,'2026-01-01','2026-01-01')`, [`cancelled-${cancelled}`, event.id, `Cancelled${cancelled % 20}`, `cancelled-${cancelled}`]);
      for (; versions < targetVersions; versions++) await db.query(`INSERT INTO lineup_versions
        (id,event_id,version,request_id,payload_json,snapshot_json,created_at)
        VALUES (?,?,?,?,'{}',?,'2026-01-01')`, [`version-${versions}`, event.id, versions + 1, `version-${versions}`, JSON.stringify({ event, teams: emptyLineup() })]);
      for (; videos < targetVideos; videos++) await db.query(`INSERT INTO event_video_submissions
        (id,event_id,name,first_url,second_url,note,created_at,group_name,profession_id,profession_name,profession_colorcode)
        VALUES (?,?,?,'https://example.test/video','','','2026-01-01','進攻一',1,'素問','#123456')`,
      [`video-${String(videos).padStart(6,'0')}`, event.id, `Video${videos}`]);
      const [batch] = await db.query('SELECT MAX(count) AS maxRecordsPerUpload FROM (SELECT COUNT(*) AS count FROM battle_records GROUP BY upload_id) batches');
      assert.ok(Number(batch.maxRecordsPerUpload) <= 2, 'fixture must respect two records per upload');
      return { size, members, battles, eventCount: events, guests, cancelled, versions, videos, playersPerBattle: 120, maxRecordsPerUpload: Number(batch.maxRecordsPerUpload) };
    },
  };
}
