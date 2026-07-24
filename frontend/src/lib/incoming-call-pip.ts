/**
 * Document Picture-in-Picture popup for incoming calls.
 * Shows a floating always-on-top window with Accept/Ignore buttons,
 * similar to WhatsApp/Telegram desktop call notifications.
 *
 * Falls back to a no-op on browsers without Document PiP support.
 */

import { IncomingCallInfo } from "@/lib/twilio-voice";

interface PipCallbacks {
  onAccept: () => void;
  onIgnore: () => void;
}

let pipWindow: Window | null = null;
let animationFrameId: number | null = null;

export function isDocumentPipSupported(): boolean {
  return "documentPictureInPicture" in window;
}

export async function showIncomingCallPip(
  info: IncomingCallInfo,
  callbacks: PipCallbacks
): Promise<void> {
  if (!isDocumentPipSupported()) return;

  // Close any existing PiP window first
  dismissIncomingCallPip();

  try {
    const pip = await (
      window as unknown as {
        documentPictureInPicture: {
          requestWindow: (opts: {
            width: number;
            height: number;
          }) => Promise<Window>;
        };
      }
    ).documentPictureInPicture.requestWindow({
      width: 380,
      height: 220,
    });

    pipWindow = pip;

    const doc = pip.document;

    doc.documentElement.innerHTML = buildPipHTML(info);

    const acceptBtn = doc.getElementById("pip-accept");
    const ignoreBtn = doc.getElementById("pip-ignore");

    acceptBtn?.addEventListener("click", () => {
      callbacks.onAccept();
      dismissIncomingCallPip();
    });

    ignoreBtn?.addEventListener("click", () => {
      callbacks.onIgnore();
      dismissIncomingCallPip();
    });

    startPulseAnimation(doc);

    pip.addEventListener("pagehide", () => {
      pipWindow = null;
      stopPulseAnimation();
    });
  } catch (e) {
    console.warn("Failed to open Document PiP for incoming call:", e);
  }
}

export function dismissIncomingCallPip(): void {
  stopPulseAnimation();
  if (pipWindow) {
    try {
      pipWindow.close();
    } catch {
      /* already closed */
    }
    pipWindow = null;
  }
}

function startPulseAnimation(doc: Document): void {
  const avatar = doc.getElementById("pip-avatar");
  if (!avatar) return;

  let growing = true;
  let scale = 1;

  const animate = () => {
    if (!avatar) return;
    scale += growing ? 0.005 : -0.005;
    if (scale >= 1.08) growing = false;
    if (scale <= 1) growing = true;
    avatar.style.transform = `scale(${scale})`;
    animationFrameId = pipWindow
      ? pipWindow.requestAnimationFrame(animate)
      : null;
  };

  animationFrameId = pipWindow
    ? pipWindow.requestAnimationFrame(animate)
    : null;
}

function stopPulseAnimation(): void {
  if (animationFrameId !== null && pipWindow) {
    try {
      pipWindow.cancelAnimationFrame(animationFrameId);
    } catch {
      /* window already closed */
    }
  }
  animationFrameId = null;
}

function buildPipHTML(info: IncomingCallInfo): string {
  const callerName = info.leadName || "Unknown Caller";
  const callerNumber = info.from || "";

  return `
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
      user-select: none;
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px;
    }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.2);
      border: 2px solid rgba(99, 102, 241, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
    }
    .avatar svg {
      width: 28px;
      height: 28px;
      color: #a5b4fc;
    }
    .caller-name {
      font-size: 18px;
      font-weight: 600;
      text-align: center;
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .caller-number {
      font-size: 13px;
      color: #94a3b8;
      margin-top: -4px;
    }
    .status {
      font-size: 12px;
      color: #6ee7b7;
      animation: blink 1.5s ease-in-out infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .actions {
      display: flex;
      gap: 32px;
      margin-top: 8px;
    }
    .btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .btn:hover {
      transform: scale(1.1);
    }
    .btn:active {
      transform: scale(0.95);
    }
    .btn-accept {
      background: #22c55e;
      box-shadow: 0 0 20px rgba(34, 197, 94, 0.4);
    }
    .btn-accept:hover {
      box-shadow: 0 0 28px rgba(34, 197, 94, 0.6);
    }
    .btn-ignore {
      background: #ef4444;
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
    }
    .btn-ignore:hover {
      box-shadow: 0 0 28px rgba(239, 68, 68, 0.6);
    }
    .btn svg {
      width: 24px;
      height: 24px;
      color: white;
    }
    .btn-label {
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
      margin-top: 4px;
    }
    .action-group {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="avatar" id="pip-avatar">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    </div>
    <div class="caller-name">${escapeHtml(callerName)}</div>
    <div class="caller-number">${escapeHtml(callerNumber)}</div>
    <div class="status">Incoming call...</div>
    <div class="actions">
      <div class="action-group">
        <button class="btn btn-ignore" id="pip-ignore" title="Ignore">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/>
            <line x1="23" y1="1" x2="1" y2="23"/>
          </svg>
        </button>
        <div class="btn-label">Ignore</div>
      </div>
      <div class="action-group">
        <button class="btn btn-accept" id="pip-accept" title="Accept">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z"/>
          </svg>
        </button>
        <div class="btn-label">Accept</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
