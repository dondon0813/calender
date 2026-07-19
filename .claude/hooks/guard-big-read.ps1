# guard-big-read.ps1 - PreToolUse hook (matcher: Read)
# Physical block: Read on a text file >50KB without limit (or limit>400) is denied.
# Rationale: .claude/harness/00-diagnosis.md pain point 1.
# Changing the threshold is a RED-level change (see 60-knowledge-protocol.md).
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 misparses UTF-8
# without BOM, and non-ASCII text here will break the whole hook.
# Any parse failure must fall through to exit 0 (a broken hook must not
# paralyze the Read tool).

$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { exit 0 }
if ($j.tool_name -ne 'Read') { exit 0 }

$fp = $j.tool_input.file_path
if (-not $fp) { exit 0 }
if (-not (Test-Path -LiteralPath $fp -PathType Leaf)) { exit 0 }

# Image/binary formats have no line-limit concept; allow.
$ext = [IO.Path]::GetExtension($fp).ToLower()
if ($ext -in @('.png','.webp','.jpg','.jpeg','.gif','.ico','.pdf','.ipynb')) { exit 0 }

$size = (Get-Item -LiteralPath $fp).Length
$limit = $j.tool_input.limit

if ($size -gt 50000 -and ((-not $limit) -or ([int]$limit -gt 400))) {
  $name = [IO.Path]::GetFileName($fp)
  [Console]::Error.WriteLine("[harness] BLOCKED whole-file Read of ${name} (${size} bytes > 50KB). Correct approach: (1) check .claude/harness/10-project-map.md for the location; (2) use Grep to locate the symbol and get line numbers; (3) Read with offset and limit (limit<=400, prefer <=200). For multi-file investigation, delegate to an Explore subagent instead of scanning yourself.")
  exit 2
}
exit 0
