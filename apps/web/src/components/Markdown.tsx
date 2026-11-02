import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders agent output read-only. Agent output is untrusted, so raw HTML is never turned into
 * elements: react-markdown leaves it out unless a raw-HTML plugin is added, so don't add one.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
