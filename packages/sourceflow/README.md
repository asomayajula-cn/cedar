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

Parsing runs when the code-map flyout opens: `POST /api/code-map/file` with the file patch builds Structure / Behavior / Functionality (`buildFileFlowArtifacts` on the server). Review slices only carry `path` + `patch` until then.

With `CEDAR_AI_CODE_MAP=auto`, that endpoint also calls the AI provider (`src/ai-code-map.js`) to author the three views from the patch + parser skeleton.

## License

MIT