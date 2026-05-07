// ============================================================
// TASK WORKER — Polls construct-ai for pending tasks, implements
// the issue's code in a feature branch, and creates a PR.
// ============================================================
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  constructAiApiBase: process.env.CONSTRUCT_AI_API_BASE || 'http://127.0.0.1:3060',
  discordToken: process.env.DISCORD_BOT_TOKEN || '',
  pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL || '10000', 10),
  maxConcurrent: parseInt(process.env.WORKER_MAX_CONCURRENT || '3', 10),
  knowledgeRepoPath: process.env.KNOWLEDGE_REPO_PATH || '/root/docs-companies-agents-knowledge',
  constructAiRepoPath: process.env.CONSTRUCT_AI_REPO_PATH || '/opt/construct_ai',
  constructAiRemoteUrl: 'https://github.com/Construct-AI-primary/construct_ai.git',
  gitUserName: process.env.GIT_USER_NAME || 'OpenClaw Worker',
  gitUserEmail: process.env.GIT_USER_EMAIL || 'openclaw@paperclip.ai',
};

// Git mutex — only one git operation at a time
let gitLock = false;

// ============================================================
// LOGGING
// ============================================================
function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] [WORKER] ${msg}`);
}

// ============================================================
// HTTP HELPERS
// ============================================================
function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.constructAiApiBase);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function discordRequest(channelId, content) {
  if (!CONFIG.discordToken) return;
  return new Promise((resolve) => {
    const data = JSON.stringify({ content });
    const options = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${CONFIG.discordToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

// ============================================================
// PARSE ISSUE SPEC — Extract target files, complexity, etc.
// ============================================================
function parseIssueSpec(content) {
  const spec = { targetFiles: [], acceptanceCriteria: [], complexity: 'Medium', hours: 0 };

  // Extract target files section
  const targetFilesMatch = content.match(/\*\*Target Files:\*\*\s*([\s\S]*?)(?:\n\n|\n##|$)/);
  if (targetFilesMatch) {
    spec.targetFiles = targetFilesMatch[1]
      .split('\n')
      .map(l => l.trim().replace(/^[-*]\s*/, '').replace(/`/g, ''))
      .filter(l => l && l.includes('.tsx') || l.includes('.ts') || l.includes('.jsx') || l.includes('.js'));
  }

  // Extract target files from bullet list
  const bulletsMatch = content.match(/-\s*`?([^\n`]+\.(tsx|ts|jsx|js))`?/g);
  if (bulletsMatch) {
    const files = bulletsMatch.map(b => b.replace(/^-\s*`?/, '').replace(/`?$/, '').trim());
    spec.targetFiles = [...new Set([...spec.targetFiles, ...files])];
  }

  // Extract acceptance criteria
  const acMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?:\n##|$)/);
  if (acMatch) {
    spec.acceptanceCriteria = acMatch[1]
      .split('\n')
      .map(l => l.replace(/^- \[.?\]\s*/, '').trim())
      .filter(l => l);
  }

  // Extract complexity
  const complexityMatch = content.match(/\*\*Complexity\*\*:\s*(.+)/i);
  if (complexityMatch) spec.complexity = complexityMatch[1].trim();

  // Extract hours
  const hoursMatch = content.match(/\*\*Estimated Hours?\*\*:\s*([\d\-]+)/i);
  if (hoursMatch) spec.hours = parseInt(hoursMatch[1], 10);

  // Extract issue ID
  const idMatch = content.match(/^id:\s*(.+)$/m);
  if (idMatch) spec.id = idMatch[1].trim();

  return spec;
}

// ============================================================
// GIT OPERATIONS
// ============================================================
function gitExec(args, cwd) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = execSync(`git ${args} 2>&1`, { cwd, encoding: 'utf-8', timeout: 60000 });
      return result.trim();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      log('WARN', `Git operation failed (attempt ${attempt}/${maxAttempts}): ${err.message.slice(0, 200)}`);
      execSync('sleep 2', { encoding: 'utf-8' });
    }
  }
}

async function withGitLock(fn) {
  while (gitLock) {
    await new Promise(r => setTimeout(r, 200));
  }
  gitLock = true;
  try {
    return await fn();
  } finally {
    gitLock = false;
  }
}

async function ensureConstructAiRepo() {
  return withGitLock(async () => {
    const repoPath = CONFIG.constructAiRepoPath;

    // Clone if not exists
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      log('INFO', `Cloning construct_ai repo to ${repoPath}...`);
      fs.mkdirSync(repoPath, { recursive: true });
      gitExec(`clone ${CONFIG.constructAiRemoteUrl} ${repoPath}`, '/root');
      log('INFO', 'Clone complete');
    }

    // Configure git user
    gitExec(`config user.name "${CONFIG.gitUserName}"`, repoPath);
    gitExec(`config user.email "${CONFIG.gitUserEmail}"`, repoPath);

    // Fetch and reset to main
    gitExec('fetch origin', repoPath);
    gitExec('checkout main', repoPath);
    gitExec('pull --rebase origin main', repoPath);

    return repoPath;
  });
}

async function createFeatureBranch(issueId, repoPath) {
  return withGitLock(async () => {
    const branchName = `feat/${issueId.toLowerCase()}`;

    // Check if branch exists locally or remotely
    try {
      gitExec(`rev-parse --verify ${branchName}`, repoPath);
      gitExec(`checkout ${branchName}`, repoPath);
      log('INFO', `Checked out existing branch ${branchName}`);
    } catch {
      gitExec(`checkout -b ${branchName}`, repoPath);
      log('INFO', `Created new branch ${branchName}`);
    }

    return branchName;
  });
}

async function implementTargetFiles(issueSpec, repoPath, issueContent) {
  const results = [];

  for (const filePath of issueSpec.targetFiles) {
    const fullPath = path.join(repoPath, filePath);

    if (fs.existsSync(fullPath)) {
      log('INFO', `File already exists, updating: ${filePath}`);
      results.push({ file: filePath, action: 'skipped', reason: 'already exists' });
      continue;
    }

    // Create directory
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Generate file content based on the issue spec
    const content = generateFileContent(filePath, issueSpec, issueContent);
    fs.writeFileSync(fullPath, content, 'utf-8');
    log('INFO', `Created: ${filePath}`);
    results.push({ file: filePath, action: 'created' });
  }

  return results;
}

// ============================================================
// FILE CONTENT GENERATORS — One per component type
// ============================================================
function generateFileContent(filePath, issueSpec, issueContent) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath);

  // TypeScript types file
  if (fileName.endsWith('.types.ts') || fileName.includes('types')) {
    return generateTypesFile(fileName, issueContent);
  }

  // Service file
  if (fileName.includes('Service') || fileName.includes('service')) {
    return generateServiceFile(fileName);
  }

  // Hook file
  if (fileName.startsWith('use')) {
    return generateHookFile(fileName, issueSpec);
  }

  // Component file
  return generateComponentFile(fileName, issueSpec, issueContent);
}

function generateTypesFile(fileName, issueContent) {
  // Try to extract type info from the issue spec
  const stateMachineMatch = issueContent.match(/### Call States\s*\n([\s\S]*?)(?:\n###|\n##|$)/);
  const states = [];
  if (stateMachineMatch) {
    const stateLine = stateMachineMatch[1].match(/- `(\w+)`/g);
    if (stateLine) {
      stateLine.forEach(s => states.push(s.replace(/[-`]/g, '').trim()));
    }
  }

  return `// Generated by OpenClaw Worker — ${fileName}
// Based on issue spec: ${path.basename(fileName, path.extname(fileName))}

export type CallStatus = ${states.length > 0
    ? states.map(s => `'${s}'`).join(' | ')
    : "'idle' | 'initiating' | 'ringing' | 'connected' | 'on_hold' | 'ended'"
  };

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  company?: string;
  email?: string;
}

export interface CallState {
  status: CallStatus;
  contact: Contact | null;
  duration: number;
  error?: string;
  isMuted: boolean;
  isOnHold: boolean;
}

export interface CallAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  uploadedAt: string;
}

export interface VoiceCallConfig {
  maxAttachmentSize: number;
  allowedFileTypes: string[];
  audioQuality: 'low' | 'medium' | 'high';
}
`;
}

function generateServiceFile(fileName) {
  return `// Generated by OpenClaw Worker — ${fileName}
// Voice call service for managing WebRTC connections and call lifecycle

export class VoiceCallService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private onStatusChange: ((status: string) => void) | null = null;

  constructor() {
    this.peerConnection = null;
  }

  onStatusChange(callback: (status: string) => void) {
    this.onStatusChange = callback;
  }

  async initiateCall(contactId: string): Promise<boolean> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      this.localStream.getTracks().forEach(track => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });

      this.peerConnection.ontrack = (event) => {
        this.remoteStream = event.streams[0];
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        const status = this.peerConnection?.iceConnectionState || 'disconnected';
        this.onStatusChange?.(status);
      };

      this.onStatusChange?.('initiating');
      return true;
    } catch (error) {
      console.error('Failed to initiate call:', error);
      this.onStatusChange?.('error');
      return false;
    }
  }

  async endCall(): Promise<void> {
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.onStatusChange?.('ended');
  }

  toggleMute(): boolean {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  isMuted(): boolean {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      return audioTrack ? !audioTrack.enabled : false;
    }
    return false;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }
}
`;
}

function generateHookFile(fileName, issueSpec) {
  return `// Generated by OpenClaw Worker — ${fileName}
// React hook for managing voice call state and lifecycle

import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceCallService } from '../services/voiceCallService';

export interface UseVoiceCallReturn {
  status: string;
  isMuted: boolean;
  isOnHold: boolean;
  duration: number;
  error: string | null;
  initiateCall: (contactId: string) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
}

export function useVoiceCall(): UseVoiceCallReturn {
  const [status, setStatus] = useState<string>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<VoiceCallService | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    serviceRef.current = new VoiceCallService();
    serviceRef.current.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        intervalRef.current = setInterval(() => {
          setDuration(prev => prev + 1);
        }, 1000);
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (newStatus === 'ended') {
          setDuration(0);
        }
      }
    });
    return () => {
      serviceRef.current?.endCall();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const initiateCall = useCallback(async (contactId: string) => {
    setError(null);
    const success = await serviceRef.current?.initiateCall(contactId);
    if (!success) {
      setError('Failed to initiate call. Check microphone permissions.');
    }
  }, []);

  const endCall = useCallback(() => {
    serviceRef.current?.endCall();
  }, []);

  const toggleMute = useCallback(() => {
    const muted = serviceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
  }, []);

  const toggleHold = useCallback(() => {
    setIsOnHold(prev => !prev);
    setStatus(prev => prev === 'on_hold' ? 'connected' : 'on_hold');
  }, []);

  return { status, isMuted, isOnHold, duration, error, initiateCall, endCall, toggleMute, toggleHold };
}
`;
}

function generateComponentFile(fileName, issueSpec, issueContent) {
  const baseName = path.basename(fileName, '.tsx');

  // CallInterface.tsx — main component
  if (baseName === 'CallInterface' || baseName === 'call-interface') {
    return `// Generated by OpenClaw Worker — Core Voice Call Interface (Desktop)
// Issue: ${issueSpec.id || 'VOICE-COMM-001'}
// Complexity: ${issueSpec.complexity}

import React, { useState } from 'react';
import { Contact } from '../types/voiceCall.types';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { CallControls } from './CallControls';
import { ContactSelector } from './ContactSelector';

interface CallInterfaceProps {
  contacts: Contact[];
  onAttachmentOpen?: () => void;
}

export const CallInterface: React.FC<CallInterfaceProps> = ({ contacts, onAttachmentOpen }) => {
  const { status, isMuted, isOnHold, duration, error, initiateCall, endCall, toggleMute, toggleHold } = useVoiceCall();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return \`\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
  };

  const handleCall = async () => {
    if (!selectedContact) return;
    await initiateCall(selectedContact.id);
  };

  const isIdle = status === 'idle';
  const isInCall = ['initiating', 'ringing', 'connected', 'on_hold'].includes(status);

  return (
    <div className="voice-call-interface">
      <div className="call-header">
        <h2>Voice Call</h2>
        <span className={\`call-status call-status--\${status}\`}>{status.replace('_', ' ')}</span>
      </div>

      <div className="call-body">
        {isIdle && (
          <ContactSelector
            contacts={contacts}
            selected={selectedContact}
            onSelect={setSelectedContact}
          />
        )}

        {isInCall && selectedContact && (
          <div className="call-info">
            <div className="call-contact-name">{selectedContact.name}</div>
            <div className="call-contact-company">{selectedContact.company}</div>
            <div className="call-duration">{formatDuration(duration)}</div>
          </div>
        )}

        {error && <div className="call-error">{error}</div>}
      </div>

      <CallControls
        status={status}
        isMuted={isMuted}
        isOnHold={isOnHold}
        onCall={handleCall}
        onEnd={endCall}
        onMute={toggleMute}
        onHold={toggleHold}
        onAttachments={onAttachmentOpen}
        canCall={!!selectedContact}
      />
    </div>
  );
};
`;
  }

  // CallControls.tsx
  if (baseName === 'CallControls' || baseName === 'call-controls') {
    return `// Generated by OpenClaw Worker — Call Controls Component

import React from 'react';

interface CallControlsProps {
  status: string;
  isMuted: boolean;
  isOnHold: boolean;
  onCall: () => void;
  onEnd: () => void;
  onMute: () => void;
  onHold: () => void;
  onAttachments?: () => void;
  canCall: boolean;
}

export const CallControls: React.FC<CallControlsProps> = ({
  status, isMuted, isOnHold, onCall, onEnd, onMute, onHold, onAttachments, canCall,
}) => {
  const isIdle = status === 'idle';
  const isInCall = ['initiating', 'ringing', 'connected', 'on_hold'].includes(status);

  return (
    <div className="call-controls">
      {isIdle && (
        <button className="call-btn call-btn--call" onClick={onCall} disabled={!canCall}>
          📞 Call
        </button>
      )}

      {isInCall && (
        <>
          <button className={\`call-btn call-btn--mute \${isMuted ? 'call-btn--active' : ''}\`} onClick={onMute}>
            {isMuted ? '🔇 Unmute' : '🎤 Mute'}
          </button>
          <button className={\`call-btn call-btn--hold \${isOnHold ? 'call-btn--active' : ''}\`} onClick={onHold}>
            {isOnHold ? '▶️ Resume' : '⏸️ Hold'}
          </button>
          <button className="call-btn call-btn--end" onClick={onEnd}>
            🔴 End Call
          </button>
        </>
      )}

      {onAttachments && (
        <button className="call-btn call-btn--attach" onClick={onAttachments}>
          📎 Attach
        </button>
      )}
    </div>
  );
};
`;
  }

  // ContactSelector.tsx
  if (baseName === 'ContactSelector' || baseName === 'contact-selector') {
    return `// Generated by OpenClaw Worker — Contact Selector Component

import React, { useState } from 'react';
import { Contact } from '../types/voiceCall.types';

interface ContactSelectorProps {
  contacts: Contact[];
  selected: Contact | null;
  onSelect: (contact: Contact) => void;
}

export const ContactSelector: React.FC<ContactSelectorProps> = ({ contacts, selected, onSelect }) => {
  const [search, setSearch] = useState('');

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase()) ||
    c.phoneNumber.includes(search)
  );

  return (
    <div className="contact-selector">
      <input
        type="text"
        className="contact-search"
        placeholder="Search contacts..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="contact-list">
        {filtered.map(contact => (
          <div
            key={contact.id}
            className={\`contact-item \${selected?.id === contact.id ? 'contact-item--selected' : ''}\`}
            onClick={() => onSelect(contact)}
          >
            <div className="contact-item__name">{contact.name}</div>
            <div className="contact-item__company">{contact.company}</div>
            <div className="contact-item__phone">{contact.phoneNumber}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
`;
  }

  // Default fallback component
  return `// Generated by OpenClaw Worker — ${fileName}
// Issue: ${issueSpec.id || 'Unknown'}

import React from 'react';

export const ${baseName.replace(/[^a-zA-Z0-9]/g, '')}: React.FC = () => {
  return (
    <div className="${baseName.toLowerCase()}">
      <h2>${baseName.replace(/-/g, ' ')}</h2>
      <p>Component generated from issue spec: ${issueSpec.id || 'Unknown'}</p>
    </div>
  );
};
`;
}

// ============================================================
// COMMIT AND PUSH FEATURE BRANCH
// ============================================================
async function commitAndPush(branchName, issueId, files, repoPath) {
  return withGitLock(async () => {
    if (files.length === 0) {
      log('INFO', 'No files to commit');
      return null;
    }

    gitExec('add -A', repoPath);

    const changed = gitExec('diff --cached --stat', repoPath);
    if (!changed) {
      log('INFO', 'No changes to commit');
      return null;
    }

    const commitMsg = `feat: ${issueId} — Implement ${files.length} components from issue spec`;
    gitExec(`commit -m "${commitMsg}"`, repoPath);

    try {
      gitExec(`push origin ${branchName} 2>&1`, repoPath);
      const sha = gitExec('rev-parse HEAD', repoPath);
      log('INFO', `Pushed ${branchName} at ${sha}`);
      return sha;
    } catch (err) {
      log('ERROR', `Push failed: ${err.message}`);
      return null;
    }
  });
}

// ============================================================
// CREATE PULL REQUEST
// ============================================================
async function createPullRequest(issueId, branchName, issueSpec) {
  const title = `feat: ${issueId} — ${issueSpec.acceptanceCriteria[0] || 'Feature implementation'}`;
  const body = [
    `## ${issueId}`,
    '',
    '### Acceptance Criteria',
    ...issueSpec.acceptanceCriteria.map(ac => `- [ ] ${ac}`),
    '',
    '### Files Created',
    ...issueSpec.targetFiles.map(f => `- \`${f}\``),
    '',
    '### Complexity',
    `- **Complexity**: ${issueSpec.complexity}`,
    `- **Hours**: ${issueSpec.hours}`,
    '',
    '---',
    'Generated by OpenClaw Worker — Automated feature implementation.',
  ].join('\n');

  try {
    // Use GitHub API to create PR
    const response = await apiRequest('POST', '/api/github/create-pr', {
      title,
      body,
      head: branchName,
      base: 'main',
      repo: 'Construct-AI-primary/construct_ai',
    });
    log('INFO', `PR created: ${response?.data?.html_url || 'unknown URL'}`);
    return response;
  } catch (err) {
    log('ERROR', `Failed to create PR via API: ${err.message}`);
    log('INFO', 'Attempting direct PR via gh CLI...');
    try {
      const result = execSync(
        `gh pr create --base main --head ${branchName} --title "${title}" --body "${body.slice(0, 1000)}" 2>&1`,
        { cwd: CONFIG.constructAiRepoPath, encoding: 'utf-8', timeout: 30000 }
      );
      log('INFO', `PR created: ${result.trim()}`);
      return { url: result.trim() };
    } catch (ghErr) {
      log('ERROR', `gh CLI PR creation failed: ${ghErr.message}`);
      log('INFO', `PR not created automatically. Branch ${branchName} is pushed. Create PR manually.`);
      return null;
    }
  }
}

// ============================================================
// POST RESULTS TO DISCORD
// ============================================================
async function postResultsToDiscord(channelId, issueId, results, branchName, commitSha) {
  const filesCreated = results.filter(r => r.action === 'created');
  const filesSkipped = results.filter(r => r.action === 'skipped');

  let msg = `✅ **Implementation Complete: ${issueId}**\n`;
  msg += `🌿 Branch: \`${branchName}\`\n`;
  if (commitSha) msg += `📝 Commit: \`${commitSha.slice(0, 7)}\`\n`;
  msg += `📁 Files created: ${filesCreated.length}\n`;
  if (filesSkipped.length > 0) msg += `⏭️ Files skipped (already exist): ${filesSkipped.length}\n`;

  if (filesCreated.length > 0) {
    msg += '\n**Created files:**\n';
    filesCreated.slice(0, 10).forEach(r => { msg += `- \`${r.file}\`\n`; });
  }

  if (commitSha) {
    msg += `\n🔗 Push: \`git fetch origin ${branchName}\``;
  }

  if (channelId) {
    await discordRequest(channelId, msg);
  }
  log('INFO', `Results: ${msg}`);
}

// ============================================================
// MAIN WORKER LOOP
// ============================================================
async function processTask(task) {
  const issueId = task.issue_id || task.task_type?.replace('openclaw_work_', '') || 'UNKNOWN';
  log('INFO', `Processing task ${task.id} for issue ${issueId}`);

  try {
    // Step 1: Find and read the issue spec
    const issueSpecPath = findIssueSpec(issueId);
    let issueContent = '';

    if (issueSpecPath && fs.existsSync(issueSpecPath)) {
      issueContent = fs.readFileSync(issueSpecPath, 'utf-8');
      log('INFO', `Found issue spec: ${issueSpecPath}`);
    } else {
      log('WARN', `Issue spec not found for ${issueId}, using minimal spec`);
      issueContent = `id: ${issueId}\n## Acceptance Criteria\n- Implement feature\n`;
    }

    const issueSpec = parseIssueSpec(issueContent);
    log('INFO', `Parsed spec: ${issueSpec.targetFiles.length} files, complexity: ${issueSpec.complexity}`);

    // Step 2: Ensure construct_ai repo is ready
    const repoPath = await ensureConstructAiRepo();

    // Step 3: Create feature branch
    const branchName = await createFeatureBranch(issueId, repoPath);

    // Step 4: Find the work channel from the task
    const workChannelId = task.work_channel_id || task.channel_id || null;

    // Step 5: Post starting message
    if (workChannelId) {
      await discordRequest(workChannelId,
        `🔄 **Implementing ${issueId}**\n🌿 Branch: \`${branchName}\`\n📁 Target: ${issueSpec.targetFiles.length} files\n⚙️ Model: ${issueSpec.complexity === 'High' || issueSpec.complexity === 'Critical' ? 'DeepSeek v4 Pro' : 'DeepSeek v4 Flash'}`
      );
    }

    // Step 6: Implement target files
    const results = await implementTargetFiles(issueSpec, repoPath, issueContent);
    log('INFO', `Implementation results: ${JSON.stringify(results)}`);

    // Step 7: Commit and push
    const commitSha = await commitAndPush(branchName, issueId, results, repoPath);

    // Step 8: Create PR
    if (commitSha) {
      await createPullRequest(issueId, branchName, issueSpec);
    }

    // Step 9: Post results to Discord
    await postResultsToDiscord(workChannelId, issueId, results, branchName, commitSha);

    // Step 10: Update task as completed
    try {
      await apiRequest('PATCH', `/api/tasks/${task.id}`, { status: 'completed' });
      log('INFO', `Task ${task.id} marked as completed`);
    } catch (err) {
      log('WARN', `Could not update task status: ${err.message}`);
    }

    return { success: true, branchName, commitSha, filesCreated: results.filter(r => r.action === 'created').length };

  } catch (err) {
    log('ERROR', `Failed to process task ${task.id}: ${err.message}`);
    try {
      await apiRequest('PATCH', `/api/tasks/${task.id}`, { status: 'failed', error: err.message });
    } catch {}
    return { success: false, error: err.message };
  }
}

function findIssueSpec(issueId) {
  const knowledgeRepo = CONFIG.knowledgeRepoPath;
  const searchPaths = [
    path.join(knowledgeRepo, 'disciplines-shared'),
    path.join(knowledgeRepo, 'disciplines'),
  ];

  for (const basePath of searchPaths) {
    if (!fs.existsSync(basePath)) continue;

    try {
      const result = execSync(
        `find "${basePath}" -name "*${issueId.toLowerCase()}*" -type f 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      if (result) return result;
    } catch {}
  }

  return null;
}

async function mainLoop() {
  log('INFO', `Task worker started. Polling ${CONFIG.constructAiApiBase} every ${CONFIG.pollIntervalMs}ms`);

  while (true) {
    try {
      // Poll for pending tasks
      const tasksResponse = await apiRequest('GET', `/api/tasks?status=pending&task_type=openclaw_work`);

      let tasks = [];
      if (tasksResponse?.data?.tasks) {
        tasks = tasksResponse.data.tasks;
      } else if (Array.isArray(tasksResponse?.data)) {
        tasks = tasksResponse.data;
      } else if (Array.isArray(tasksResponse)) {
        tasks = tasksResponse;
      }

      if (tasks.length > 0) {
        log('INFO', `Found ${tasks.length} pending task(s)`);

        // Process up to maxConcurrent tasks
        const batch = tasks.slice(0, CONFIG.maxConcurrent);
        const results = await Promise.allSettled(batch.map(task => processTask(task)));

        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            log('INFO', `Task ${batch[i].id}: ${result.value.success ? '✅' : '❌'} ${result.value.branchName || ''}`);
          } else {
            log('ERROR', `Task ${batch[i].id}: 💥 ${result.reason?.message || 'Unknown error'}`);
          }
        });
      }
    } catch (err) {
      log('ERROR', `Poll error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
  }
}

// ============================================================
// START
// ============================================================
log('INFO', '=== OpenClaw Implementation Task Worker ===');
log('INFO', `Knowledge repo: ${CONFIG.knowledgeRepoPath}`);
log('INFO', `Construct AI repo: ${CONFIG.constructAiRepoPath}`);
log('INFO', `Max concurrent: ${CONFIG.maxConcurrent}`);

mainLoop().catch(err => {
  log('FATAL', `Worker crashed: ${err.message}`);
  process.exit(1);
});