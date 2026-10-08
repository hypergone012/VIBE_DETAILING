/** Minimal typing for liquid-gl 3.0.0 (the package ships no declarations). */
declare module 'liquid-gl' {
  interface LiquidGLLens {
    destroy(): void;
    setTint?(color: string): void;
  }
  type LiquidGL = ((options: Record<string, unknown>) => LiquidGLLens | LiquidGLLens[] | undefined) & {
    registerDynamic?(target: string | Element[]): void;
    syncWith?(options: Record<string, unknown>): unknown;
  };
  const liquidGL: LiquidGL;
  export default liquidGL;
}
