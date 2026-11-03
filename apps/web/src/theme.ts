import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/** Colors and fonts live in styles.css, so Chakra and Tailwind share one set of values. */
export const system = createSystem(
  defaultConfig,
  defineConfig({
    theme: {
      tokens: {
        fonts: {
          body: { value: 'var(--font-sans)' },
          heading: { value: 'var(--font-sans)' },
          mono: { value: 'var(--font-mono)' },
        },
      },
    },
  }),
);
