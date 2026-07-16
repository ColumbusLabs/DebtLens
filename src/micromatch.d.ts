declare module "micromatch" {
  export interface Options {
    dot?: boolean;
    nonegate?: boolean;
  }

  interface Micromatch {
    isMatch(value: string, pattern: string, options?: Options): boolean;
    makeRe(pattern: string, options?: Options): RegExp;
  }

  const micromatch: Micromatch;
  export default micromatch;
}
