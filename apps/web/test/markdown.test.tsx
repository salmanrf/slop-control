import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/components/Markdown';

describe('Markdown', () => {
  it('renders markdown', () => {
    render(<Markdown source={'# Findings\n\nThe **cause** is here.'} />);
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByText('cause').tagName).toBe('STRONG');
  });

  it('renders a table', () => {
    render(<Markdown source={'| Option | Verdict |\n| --- | --- |\n| Close | Recommended |'} />);
    expect(screen.getByRole('columnheader', { name: 'Option' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Recommended' })).toBeInTheDocument();
  });

  it('does not create elements from raw HTML inside a table', () => {
    const { container } = render(
      <Markdown source={'| A |\n| --- |\n| <img src="x" onerror="alert(1)"> |'} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not create elements from raw HTML in agent output', () => {
    const { container } = render(
      <Markdown
        source={
          '<script>window.x = 1</script>\n\n<img src="x" onerror="alert(1)">\n\n<iframe src="https://evil.example"></iframe>'
        }
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('does not keep a javascript: link', () => {
    const { container } = render(<Markdown source={'[click](javascript:alert(1))'} />);
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
  });

  it('opens links without giving the new page access to this one', () => {
    render(<Markdown source={'[docs](https://example.com)'} />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
