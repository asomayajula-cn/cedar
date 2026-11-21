# sourceflow

Structure and behavior maps for **SQL**, **Java**, and **JS/TS**, with a React + XY Flow renderer.

Cedar uses this package for the PR review **Code map** flyout.

## Install

```bash
npm install sourceflow
```

Peer: `react`, `react-dom` ≥ 18.

## React (Cedar flyout)

```jsx
import { mountSourceFlow, unmountSourceFlow } from "sourceflow/react";

mountSourceFlow(container, {
  elements, // from Cedar review `codeMapElements`
  isDay: false,
  mapLang: "java",
  rankdir: "TB",
  classPrefix: "cedar-code-map", // match Cedar CSS
  fitMetrics: { fitPadding: 72, postScale: 0.88, maxFitZoom: 1 },
  onEngineReady: (api) => {
    api.fitView();
  },
});
```

Parsing runs on the Cedar server (`buildFileFlowArtifacts`); the browser receives `elements` plus summary fields for Structure / Behavior / Layout.

## License

MIT