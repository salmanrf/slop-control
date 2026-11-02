import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorMessage } from '../src/components/common';

describe('ErrorMessage', () => {
  it('announces the error to assistive technology', () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <ErrorMessage error={new Error('That path does not exist.')} />
      </ChakraProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('That path does not exist.');
  });

  it('renders nothing without an error', () => {
    const { container } = render(
      <ChakraProvider value={defaultSystem}>
        <ErrorMessage error={null} />
      </ChakraProvider>,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
