import { useEffect, useRef, useCallback } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpAppMessage } from '../store/types';

const HOST_INFO = { name: 'PlannerHost', version: '1.0.0' };

interface UseAppBridgeOptions {
  mcpApp: McpAppMessage;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onTeardown?: () => void;
}

/**
 * Hook that manages the AppBridge lifecycle for a single MCP App instance.
 *
 * 1. Connects an MCP Client to the MCP server (Streamable HTTP)
 * 2. Reads the UI resource HTML
 * 3. Creates an AppBridge and connects it to the iframe via PostMessageTransport
 * 4. Sends tool input + tool result to the iframe
 * 5. Tears down gracefully on unmount
 */
export function useAppBridge({ mcpApp, iframeRef, onTeardown }: UseAppBridgeOptions) {
  const bridgeRef = useRef<AppBridge | null>(null);
  const clientRef = useRef<Client | null>(null);
  const mcpAppRef = useRef(mcpApp);
  const onTeardownRef = useRef(onTeardown);
  mcpAppRef.current = mcpApp;
  onTeardownRef.current = onTeardown;

  useEffect(() => {
    const mcpApp = mcpAppRef.current;
    let cancelled = false;

    async function init() {
      console.log('[AppBridge] init() started', {
        resourceUri: mcpApp.resourceUri,
        mcpServerUrl: mcpApp.mcpServerUrl,
      });
      console.log('[AppBridge] cancelled:', cancelled);
      const iframe = iframeRef.current;
      if (!iframe) {
        console.log('[AppBridge] init() abort: iframe ref is null');
        return;
      }

      try {
        // 1. Connect MCP client to the server
        console.log('[AppBridge] connecting to MCP client', {
          mcpServerUrl: mcpApp.mcpServerUrl,
        });
        const client = new Client(HOST_INFO);
        console.log('[AppBridge] created MCP client');
        const transport = new StreamableHTTPClientTransport(
          new URL(mcpApp.mcpServerUrl)
        );

        await client.connect(transport);
        if (cancelled) { await client.close(); return; };
        clientRef.current = client;

        // 2. Read the UI resource HTML
        console.log('[AppBridge] readResource request:', {
          uri: mcpApp.resourceUri,
          mcpServerUrl: mcpApp.mcpServerUrl,
        });
        const resource = await client.readResource({ uri: mcpApp.resourceUri });
        if (cancelled) { await client.close(); return; }

        console.log('[AppBridge] readResource response:', {
          contentsLength: resource.contents?.length,
          firstContentUri: resource.contents?.[0] ? (resource.contents[0] as { uri?: string }).uri : undefined,
          firstContentMimeType: resource.contents?.[0] ? (resource.contents[0] as { mimeType?: string }).mimeType : undefined,
        });
        const content = resource.contents[0];
        if (!content || content.mimeType !== RESOURCE_MIME_TYPE) {
          console.error('[AppBridge] Invalid resource MIME type:', content?.mimeType);
          return;
        }
        const html = 'blob' in content ? atob(content.blob as string) : (content as { text: string }).text;
        console.log('[AppBridge] Extracted HTML:', { htmlLength: html?.length, hasHtml: !!html });
        console.log(html.substring(0, 500));

        // 3. Create AppBridge (no MCP client forwarding — we pass null
        //    since the editor calls tools directly via callServerTool)
        const serverCapabilities = client.getServerCapabilities();
        const bridge = new AppBridge(client, HOST_INFO, {
          openLinks: {},
          serverTools: serverCapabilities?.tools,
          serverResources: serverCapabilities?.resources,
        }, {
          hostContext: {
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
            platform: 'web',
            containerDimensions: { maxHeight: 500 },
            displayMode: 'inline',
          },
        });
        bridgeRef.current = bridge;

        // Register handlers before connect
        bridge.onmessage = async (params) => {
          console.log('[AppBridge] Message from app:', params);
          return {};
        };

        bridge.onopenlink = async (params) => {
          window.open(params.url, '_blank', 'noopener,noreferrer');
          return {};
        };

        bridge.onloggingmessage = (params) => {
          console.log('[AppBridge] Log:', params);
        };

        bridge.onsizechange = async ({ width, height }) => {
          if (height !== undefined) {
            iframe.style.height = `${height}px`;
          }
          if (width !== undefined) {
            iframe.style.minWidth = `min(${width}px, 100%)`;
          }
        };

        // MCP Apps spec: Host must be ready to receive ui/initialize before the View loads.
        // Connect bridge FIRST so we don't miss the editor's initialize message.
        const appInitializedPromise = new Promise<void>((resolve) => {
          bridge.oninitialized = () => resolve();
        });

        await bridge.connect(
          new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
        );
        if (cancelled) return;

        // Now load the editor HTML - it will send ui/initialize immediately
        iframe.srcdoc = html;

        await new Promise<void>((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
        });
        if (cancelled) return;

        await appInitializedPromise;
        if (cancelled) return;

        // 4. Send tool input + result per MCP Apps spec
        // sendToolInput: tool arguments (editor uses project_name for loading message)
        // sendToolResult: MCP CallToolResult format { content: [{ type: 'text', text }] }
        console.log('[AppBridge] sending tool input:', { toolResult: mcpApp.toolResult });
        const toolArgs = (mcpApp.toolResult?.project_name != null)
          ? { project_name: mcpApp.toolResult.project_name, project_id: mcpApp.toolResult.project_id ?? '' }
          : (mcpApp.toolResult as Record<string, unknown>);
        bridge.sendToolInput({ arguments: toolArgs });

        bridge.sendToolResult({
          content: [{ type: 'text', text: JSON.stringify(mcpApp.toolResult) }],
        });

      } catch (err) {
        console.error('[AppBridge] Initialization failed:', err);
      }
    }

    init();

    return () => {
      cancelled = true;
      const bridge = bridgeRef.current;
      const client = clientRef.current;

      async function cleanup() {
        if (bridge) {
          try {
            await bridge.teardownResource({});
          } catch { /* ignore */ }
          try {
            await bridge.close();
          } catch { /* ignore */ }
          // Only remove from store when a bridge was actually established
          onTeardownRef.current?.();
        }
        if (client) {
          try {
            await client.close();
          } catch { /* ignore */ }
        }
      }
      cleanup();
    };
  }, [iframeRef]);

  const sendContextChange = useCallback((context: Record<string, unknown>) => {
    bridgeRef.current?.sendHostContextChange(context);
  }, []);

  return { sendContextChange };
}
