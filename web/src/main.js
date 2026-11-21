import "diff2html/bundles/css/diff2html.min.css";
import "./style.css";
import "./theme-night.css";
import "./theme-day.css";
import { initAppTheme } from "./theme.js";
import { mountApp } from "./app.js";

initAppTheme();
mountApp(document.getElementById("app"));