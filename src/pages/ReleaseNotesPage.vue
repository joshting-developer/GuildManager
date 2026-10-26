<script setup>
// Notes ship inside the build; pending changes stay in Unreleased until GAS delivery.
import notes from '../content/release-notes.json';

const currentVersion = __APP_VERSION__;
const hasUnreleased = notes.some((release) => release.version === 'Unreleased');
const SECTION_ORDER = ['新功能', '效能', '修正', '其他'];
const releases = notes.map((release) => ({
  ...release,
  unreleased: release.version === 'Unreleased',
  groups: Object.entries(release.sections || {})
    .filter(([, items]) => items.length)
    .sort(([a], [b]) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)),
}));
const dateLabel = (date) => date.replace(/-/g, '/');
</script>

<template>
  <section class="page-heading" aria-labelledby="release-notes-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 版本</p>
      <h1 id="release-notes-title">更新紀錄<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">
        {{ hasUnreleased ? '目前包含未發布改動。最近定版' : '每次發布的改動摘要。目前版本' }}
        <strong>v{{ currentVersion }}</strong>
      </p>
    </div>
  </section>
  <p v-if="!releases.length" class="notes-empty">尚無更新紀錄。</p>
  <ol v-else class="release-list">
    <li v-for="release in releases" :key="release.version">
      <v-card
        class="release-card"
        :class="{ 'release-current': release.unreleased || (!hasUnreleased && release.version === currentVersion) }"
      >
        <div class="release-head">
          <h2>{{ release.unreleased ? '未發布' : `v${release.version}` }}</h2>
          <span v-if="release.unreleased" class="release-badge">累積中</span>
          <span v-else-if="release.version === currentVersion" class="release-badge">{{ hasUnreleased ? '最近定版' : '目前版本' }}</span>
          <span v-if="release.unreleased" class="release-date">尚未定版</span>
          <time v-else class="release-date" :datetime="release.date">{{ dateLabel(release.date) }}</time>
        </div>
        <p v-if="release.summary" class="release-summary">{{ release.summary }}</p>
        <section v-for="[title, items] in release.groups" :key="title" class="release-group">
          <h3>{{ title }}</h3>
          <ul>
            <li v-for="(item, index) in items" :key="index">{{ item }}</li>
          </ul>
        </section>
      </v-card>
    </li>
  </ol>
  <p class="notes-footnote">v1.0.5 及更早的版本沒有留下更新紀錄。</p>
</template>

<style scoped>
.release-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 16px;
}
.release-card {
  padding: 24px;
}
.release-current {
  border-color: var(--color-primary);
}
.release-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}
.release-head h2 {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.release-badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--color-info-surface);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 600;
}
.release-date {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.release-summary {
  margin: 8px 0 0;
  font-weight: 600;
}
.release-group h3 {
  margin: 16px 0 6px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 700;
}
.release-group ul {
  margin: 0;
  padding-left: 20px;
  line-height: 1.7;
}
.notes-empty,
.notes-footnote {
  color: var(--color-text-muted);
}
.notes-footnote {
  margin-top: 20px;
  font-size: 13px;
}
@media (max-width: 600px) {
  .release-card {
    padding: 16px;
  }
  .release-date {
    margin-left: 0;
    width: 100%;
  }
}
</style>
