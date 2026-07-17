import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAdvisorTool } from "../src/tools.js";
import { registerCommands } from "../src/commands.js";

export default function (pi: ExtensionAPI) {
  registerAdvisorTool(pi);
  registerCommands(pi);
}
