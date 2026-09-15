import { createApp } from "vue";
import {
  ElButton,
  ElOption,
  ElSelect,
  ElTag,
  ElTooltip,
} from "element-plus";
import "element-plus/theme-chalk/base.css";
import "element-plus/theme-chalk/el-button.css";
import "element-plus/theme-chalk/el-option.css";
import "element-plus/theme-chalk/el-select.css";
import "element-plus/theme-chalk/el-tag.css";
import "element-plus/theme-chalk/el-tooltip.css";

import App from "./App.vue";
import "./styles.css";

const app = createApp(App);

app.use(ElButton);
app.use(ElOption);
app.use(ElSelect);
app.use(ElTag);
app.use(ElTooltip);

app.mount("#app");
