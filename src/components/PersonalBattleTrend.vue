<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useTheme } from 'vuetify';
import { init, use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { PERSONAL_TREND_METRICS, personalTrendPoints } from '../domain/personal-battle-selection.js';

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
const props = defineProps({ entries: { type: Array, required: true } });
const theme = useTheme();
const metric = ref('playerDamage'), element = ref(null), chartError = ref(''), detailsOpen = ref(false), detailPage = ref(1);
const points = computed(() => personalTrendPoints(props.entries, metric.value));
const metricLabel = computed(() => PERSONAL_TREND_METRICS.find((item) => item.value === metric.value).title);
const detailPoints = computed(() => points.value.slice((detailPage.value - 1) * 20, detailPage.value * 20));
const label = (value) => value == null ? '—' : value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
let chart, observer, frame;
function render() {
  if (!element.value) return;
  if (!points.value.length) { chart?.clear(); return; }
  const dark = theme.current.value.dark;
  const color = dark ? '#cbd5e1' : '#475569';
  try {
    chart ||= init(element.value, null, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    chart.setOption({
      animation: false,
      textStyle: { color },
      grid: { left: 12, right: 20, top: 28, bottom: 78, containLabel: true },
      tooltip: { trigger: 'axis', renderMode: 'richText', valueFormatter: label },
      xAxis: { type: 'category', data: points.value.map((point) => point.label), axisLabel: { color, hideOverlap: true, width: 115, overflow: 'truncate' } },
      yAxis: { type: 'value', axisLabel: { color }, splitLine: { lineStyle: { color: dark ? '#334155' : '#e2e8f0' } } },
      dataZoom: [{ type: 'slider', bottom: 8, height: 24, textStyle: { color }, start: 0, end: 100 }, { type: 'inside', zoomOnMouseWheel: false }],
      series: [{ name: metricLabel.value, type: 'line', data: points.value.map((point) => point.value), connectNulls: false,
        sampling: 'lttb', showSymbol: points.value.length <= 100, symbolSize: 7, lineStyle: { width: 2 }, itemStyle: { color: dark ? '#60a5fa' : '#2563eb' } }],
    }, { notMerge: true, lazyUpdate: true });
    chartError.value = '';
  } catch {
    chartError.value = '圖表暫時無法顯示，仍可查看下方數據或重試。';
  }
}
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}
watch([points, () => theme.current.value.dark], schedule);
watch(points, () => { detailPage.value = 1; });
onMounted(() => {
  observer = new ResizeObserver(() => { chart?.resize(); });
  observer.observe(element.value);
  schedule();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <v-card class="battle-view-card mb-6">
    <div class="section-header">
      <h2>數據走勢</h2>
      <v-select v-model="metric" :items="PERSONAL_TREND_METRICS" label="走勢指標" variant="outlined" density="compact" hide-details class="trend-select" />
    </div>
    <p class="battle-view-muted">依已勾選且符合篩選的紀錄，由舊到新呈現；缺值保留斷點，可拖曳下方滑桿縮放。</p>
    <p v-if="metric === 'killEfficiency'" class="battle-view-muted">擊殺效率＝對玩家傷害 ÷ 擊敗數，單位為傷害／人；數值越低代表每次擊敗所需傷害較少。零擊敗或缺值顯示 —。</p>
    <p v-if="!points.length" class="battle-view-state">請勾選下方戰績以顯示走勢。</p>
    <v-alert v-if="chartError" type="error" variant="tonal">{{ chartError }}<v-btn variant="text" @click="schedule">重試圖表</v-btn></v-alert>
    <div ref="element" class="personal-trend" role="img" :aria-label="`${metricLabel}走勢，共 ${points.length} 筆；精確數據可展開下方走勢數據查看。`" :style="{ display: points.length ? undefined : 'none' }" />
    <details v-if="points.length" class="mt-3" @toggle="detailsOpen = $event.target.open">
      <summary>查看走勢數據（{{ points.length }} 筆）</summary>
      <div v-if="detailsOpen" class="battle-view-scroll" tabindex="0" aria-label="走勢精確數據，可左右捲動">
        <table class="battle-view-table"><thead><tr><th scope="col">場次</th><th scope="col">{{ metricLabel }}</th></tr></thead>
          <tbody><tr v-for="point in detailPoints" :key="point.key"><td>{{ point.label }}</td><td class="numeric">{{ label(point.value) }}</td></tr></tbody>
        </table>
      </div>
      <v-pagination v-if="detailsOpen && points.length > 20" v-model="detailPage" :length="Math.ceil(points.length / 20)" :total-visible="5" aria-label="走勢數據分頁" />
    </details>
  </v-card>
</template>

<style scoped>
.trend-select { max-width: 340px; min-width: 220px; }
.personal-trend { height: 360px; width: 100%; }
summary { cursor: pointer; padding: 12px 0; }
@media (max-width: 767px) { .trend-select { max-width: 100%; width: 100%; } .personal-trend { height: 300px; } }
</style>
