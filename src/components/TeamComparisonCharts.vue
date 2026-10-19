<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useTheme } from 'vuetify';
import { init, use } from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { comparisonMetricShares } from '../domain/team-battle-analysis.js';

use([PieChart, TitleComponent, TooltipComponent, CanvasRenderer]);
const props = defineProps({ groups: { type: Array, required: true }, metrics: { type: Array, required: true } });
const theme = useTheme(), element = ref(null), error = ref('');
const colors = ['#e85858', '#2689c8'];
const charts = computed(() => props.metrics.map(([label, key]) => ({ label, key, ...comparisonMetricShares(props.groups, key) })));
const numberLabel = value => value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
let chart, observer, frame;
function draw() {
  if (!element.value?.clientWidth) return;
  const width = element.value.clientWidth, columns = width >= 900 ? 3 : width >= 560 ? 2 : 1;
  const cellWidth = width / columns, cellHeight = 230;
  const dark = theme.current.value.dark, text = dark ? '#cbd5e1' : '#475569';
  element.value.style.height = `${Math.ceil(charts.value.length / columns) * cellHeight}px`;
  try {
    chart ||= init(element.value, null, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    chart.resize();
    chart.setOption({
      animation: false, color: colors,
      tooltip: { trigger: 'item', renderMode: 'richText',
        formatter: item => `${item.seriesName}\n${item.name}：${numberLabel(item.value)}（${numberLabel(item.percent)}%）` },
      title: charts.value.map((item, index) => ({
        text: item.label, subtext: item.reason, textAlign: 'center',
        left: cellWidth * (index % columns + 0.5), top: Math.floor(index / columns) * cellHeight + 8,
        textStyle: { color: text, fontSize: 15 }, subtextStyle: { color: text, fontSize: 11, width: cellWidth - 16, overflow: 'break' },
      })),
      series: charts.value.map((item, index) => ({
        name: item.label, type: 'pie', stillShowZeroSum: false, showEmptyCircle: false,
        center: [cellWidth * (index % columns + 0.5), Math.floor(index / columns) * cellHeight + 130],
        radius: Math.min(cellWidth * 0.32, 76),
        label: { color: text, formatter: '{d}%', position: 'inside' }, percentPrecision: 2,
        data: item.slices.map(({ name, value }) => ({ name, value })),
      })),
    }, { notMerge: true, lazyUpdate: true });
    error.value = '';
  } catch { error.value = '圓餅圖暫時無法顯示，可重試；精確數值仍可查看合計表。'; }
}
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }
watch([charts, () => theme.current.value.dark], schedule);
onMounted(() => { observer = new ResizeObserver(schedule); observer.observe(element.value); schedule(); });
onBeforeUnmount(() => { cancelAnimationFrame(frame); observer?.disconnect(); chart?.dispose(); });
</script>

<template>
  <section class="team-share-charts" aria-label="各指標比較組合內占比">
    <ul class="team-share-legend"><li v-for="(group, index) in groups" :key="group.id"><span :style="{ background: colors[index] }" aria-hidden="true"></span>{{ group.name }}</li></ul>
    <p class="battle-view-muted">圓餅圖分母是目前兩個比較組合的合計；合計表「占全場％」的分母則是同陣營全部玩家，包含未歸類。缺值、部分資料或合計為 0 時不繪製占比；重傷只表示次數占比。</p>
    <v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}<v-btn variant="text" @click="schedule">重試圖表</v-btn></v-alert>
    <div ref="element" class="team-share-canvas" role="img" :aria-label="charts.map(item => `${item.label}：${item.reason || item.slices.map(slice => `${slice.name} ${numberLabel(slice.percent)}%`).join('，')}`).join('；')" />
  </section>
</template>

<style scoped>
.team-share-legend { display: flex; flex-wrap: wrap; gap: 12px 24px; list-style: none; padding: 0; margin: 0 0 12px; }
.team-share-legend li { display: flex; align-items: center; gap: 8px; }
.team-share-legend span { display: inline-block; width: 12px; height: 12px; border-radius: 50%; }
.team-share-canvas { width: 100%; min-height: 230px; margin-top: 16px; }
</style>
