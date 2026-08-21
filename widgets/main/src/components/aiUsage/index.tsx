import ClaudeUsage from '../claudeUsage';
import CodexUsage from '../codexUsage';

export default function AiUsage() {
  return (
    <div className="flex items-center gap-2 h-full ml-2">
      <ClaudeUsage />
      <CodexUsage />
    </div>
  );
}
