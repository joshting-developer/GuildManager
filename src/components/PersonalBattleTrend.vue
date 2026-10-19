<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useTheme } from 'vuetify';
import { init, use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { PERSONAL_TREND_METRICS, personalTrendPoints } from '../domain/personal-battle-selection.js';

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
const props = defineProps({ entries: { type: Array, required: true }, active: Boolean });
const theme = useTheme();
const metric = ref('playerDamage'), element = ref(null), chartError = ref('');
const points = computed(() => personalTrendPoints(props.entries, metric.value));
const metricLabel = computed(() => PERSONAL_TREND_METRICS.find((item) => item.value === metric.value).title);
const label = (value) => value == null ? '—' : value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
let chart, observer, frame, renderedEntries, renderedMetric, renderedDark;
function render() {
  if (!props.active || !element.value) return;
  if (!points.value.length) { chart?.clear(); renderedEntries = undefined; return; }
  const dark = theme.current.value.dark;
  const color = dark ? '#cbd5e1' : '#475569';
  try {
    chart ||= init(element.value, null, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    chart.resize();
    if (renderedEntries === props.entries && renderedMetric === metric.value && renderedDark === dark && !chartError.value) return;
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
    renderedEntries = props.entries;
    renderedMetric = metric.value;
    renderedDark = dark;
  } catch {
    chartError.value = '圖表暫時無法顯示，可重試或返回戰績表格查看數據。';
  }
}
function schedule() {
  cancelAnimationFrame(frame);
  if (!props.active) return;
  frame = requestAnimationFrame(render);
}
watch([() => props.entries, metric, () => theme.current.value.dark, () => props.active], schedule);
defineExpose({ refresh: schedule });
onMounted(() => {
  observer = new ResizeObserver(() => { if (props.active) chart?.resize(); });
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
  <div class="personal-trend-content">
    <div class="personal-trend-controls">
      <v-select v-model="metric" :items="PERSONAL_TREND_METRICS" label="走勢指標" variant="outlined" density="compact" hide-details class="trend-select" />
    </div>
    <p class="battle-view-muted">依已勾選且符合篩選的紀錄，由舊到新呈現；缺值保留斷點，可拖曳下方滑桿縮放。</p>
    <p v-if="metric === 'killEfficiency'" class="battle-view-muted">擊殺效率＝對玩家傷害 ÷ 擊敗數，單位為傷害／人；數值越低代表每次擊敗所需傷害較少。零擊敗或缺值顯示 —。</p>
    <p v-if="active && !entries.length" class="battle-view-state">尚未勾選符合條件的紀錄，請返回戰績表格選取。</p>
    <v-alert v-if="chartError" type="error" variant="tonal">{{ chartError }}<v-btn variant="text" @click="schedule">重試圖表</v-btn></v-alert>
    <div ref="element" class="personal-trend" role="img" :aria-label="`${metricLabel}走勢，共 ${active ? points.length : 0} 筆；精確數據可返回各場戰績表格查看。`" :style="{ display: active && entries.length ? undefined : 'none' }" />
  </div>
</template>

<style scoped>
.trend-select { max-width: 340px; min-width: 220px; }
.personal-trend-controls { display: flex; justify-content: flex-end; margin-bottom: 20px; }
.personal-trend { height: clamp(320px, 55vh, 560px); width: 100%; margin-top: 16px; }
@media (max-width: 767px) { .trend-select { max-width: 100%; width: 100%; } .personal-trend { height: 300px; } }
</style>
