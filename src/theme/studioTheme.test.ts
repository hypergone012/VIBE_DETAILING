import { describe, expect, it } from 'vitest';
import { onAccentColor } from './studioTheme';

describe('accent contrast', () => {
  it('picks the readable text color for the configured accent', () => {
    expect(onAccentColor('#4690FF')).toBe('#000000'); // 6.8:1 vs 3.1:1 for white
    expect(onAccentColor('#FFB020')).toBe('#000000');
    expect(onAccentColor('#1E3A8A')).toBe('#FFFFFF');
  });
});
