declare module "*.css" {
  const content: string;
  export default content;
}

/** Vite CSS modules (`.module.scss` matches `*.scss` last — use one declaration for all `.scss`) */
declare module "*.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*?inline" {
  const content: string;
  export default content;
}
