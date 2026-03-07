import type { FigureType } from '../../types/models';

export const FIGURE_TYPES: Record<FigureType, { description: string }> = {
  overall_framework: {
    description:
      'An end-to-end pipeline figure showing the complete flow from raw input through all processing stages to the final output. Uses a horizontal left-to-right layout with labeled stage blocks connected by annotated arrows indicating data types.',
  },
  network_architecture: {
    description:
      'A detailed layer-by-layer diagram of the neural network or computational graph at the core of the paper. Shows individual layer types as distinct geometric shapes with parameter counts and tensor dimension labels on connecting arrows.',
  },
  module_detail: {
    description:
      'A close-up figure zooming into one specific novel contribution of the paper and revealing its internal data-flow mechanics, including operation nodes, color-coded streams, formulas, and complexity annotations.',
  },
  comparison_ablation: {
    description:
      'A grid figure comparing the proposed method against baselines or ablation variants, with rows representing samples or variants and columns representing methods, metrics, highlights, and optional zoom insets.',
  },
  data_behavior: {
    description:
      'A visualization figure showing how data or learned representations behave, typically combining attention heatmaps, t-SNE or UMAP plots, training curves, or feature-map grids in a multi-panel layout.',
  },
};
