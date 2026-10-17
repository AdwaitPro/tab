import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createContext } from "./lib/context.js";
import { runTool } from "./lib/result.js";
import { betAction, betActionInput, betActionTool, betCreate, betCreateInput, betCreateTool, betOutput } from "./tools/bet.js";
import { dealAction, dealActionInput, dealActionTool, dealCreate, dealCreateInput, dealCreateTool, dealOutput } from "./tools/deal.js";
import { list, listInput, listOutput, listTool } from "./tools/list.js";
import { pay, payInput, payOutput, payTool } from "./tools/pay.js";
import { quote, quoteInput, quoteOutput, quoteTool } from "./tools/quote.js";
import { request, requestInput, requestOutput, requestTool } from "./tools/request.js";
import { split, splitInput, splitOutput, splitTool } from "./tools/split.js";
import { status, statusInput, statusOutput, statusTool } from "./tools/status.js";

const PROTOCOL_VERSION = "2026-07-28";

// Config and network clients are built inside each call (createContext), never at import or discovery time.
function createServer() {
  const server = new McpServer(
    { name: "tab", title: "Tab: multiplayer money", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(requestTool.name, { ...requestTool, inputSchema: requestInput, outputSchema: requestOutput },
    (args) => runTool(requestTool.name, () => request(args, createContext())));
  server.registerTool(splitTool.name, { ...splitTool, inputSchema: splitInput, outputSchema: splitOutput },
    (args) => runTool(splitTool.name, () => split(args, createContext())));
  server.registerTool(payTool.name, { ...payTool, inputSchema: payInput, outputSchema: payOutput },
    (args) => runTool(payTool.name, () => pay(args, createContext())));
  server.registerTool(statusTool.name, { ...statusTool, inputSchema: statusInput, outputSchema: statusOutput },
    (args) => runTool(statusTool.name, () => status(args, createContext())));
  server.registerTool(listTool.name, { ...listTool, inputSchema: listInput, outputSchema: listOutput },
    (args) => runTool(listTool.name, () => list(args, createContext())));
  server.registerTool(dealCreateTool.name, { ...dealCreateTool, inputSchema: dealCreateInput, outputSchema: dealOutput },
    (args) => runTool(dealCreateTool.name, () => dealCreate(args, createContext())));
  server.registerTool(dealActionTool.name, { ...dealActionTool, inputSchema: dealActionInput, outputSchema: dealOutput },
    (args) => runTool(dealActionTool.name, () => dealAction(args, createContext())));
  server.registerTool(betCreateTool.name, { ...betCreateTool, inputSchema: betCreateInput, outputSchema: betOutput },
    (args) => runTool(betCreateTool.name, () => betCreate(args, createContext())));
  server.registerTool(betActionTool.name, { ...betActionTool, inputSchema: betActionInput, outputSchema: betOutput },
    (args) => runTool(betActionTool.name, () => betAction(args, createContext())));
  server.registerTool(quoteTool.name, { ...quoteTool, inputSchema: quoteInput, outputSchema: quoteOutput },
    (args) => runTool(quoteTool.name, () => quote(args, createContext())));

  return server;
}

serveStdio(createServer, { legacy: "reject" });
