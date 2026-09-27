/**
 * ECharts, loaded module by module.
 *
 * `import * as echarts from "echarts"` pulls every series, component and
 * renderer the library ships -- maps, graphs, 3D-less globes, SVG -- into the
 * one chunk every chart screen downloads. This registers exactly what the
 * application draws, and every runtime use of ECharts goes through here
 * (`Chart.tsx` and the tests that look an instance up). Type imports from
 * "echarts" elsewhere are erased at build time and cost nothing.
 *
 * A chart that needs a series or a component not listed below renders
 * nothing and logs why in the console: add it here.
 *
 * `LegacyGridContainLabel`: ECharts 6 replaced `grid.containLabel` with
 * `outerBounds`; the grids here still say `containLabel: true`, and in a
 * modular build that keeps working only with this feature installed.
 */
import { BarChart, HeatmapChart, LineChart, PieChart, TreemapChart } from "echarts/charts";
import {
  AxisPointerComponent,
  CalendarComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, LegacyGridContainLabel } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  TreemapChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  CalendarComponent,
  VisualMapContinuousComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  LabelLayout,
  LegacyGridContainLabel,
  CanvasRenderer,
]);

export { echarts };
