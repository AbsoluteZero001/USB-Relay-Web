import { createApp } from "vue";
import {
  ElButton,
  ElDialog,
  ElDivider,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTag,
  ElTooltip,
} from "element-plus";
import "element-plus/dist/index.css";

import App from "./App.vue";
import "./styles.css";

const app = createApp(App);

app.use(ElButton);
app.use(ElDialog);
app.use(ElDivider);
app.use(ElForm);
app.use(ElFormItem);
app.use(ElInput);
app.use(ElInputNumber);
app.use(ElOption);
app.use(ElSelect);
app.use(ElSwitch);
app.use(ElTag);
app.use(ElTooltip);

app.mount("#app");
