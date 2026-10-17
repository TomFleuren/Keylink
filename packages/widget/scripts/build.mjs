import esbuild from "esbuild";

const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  target: "es2022",
  minify: true,
  sourcemap: true,
};

await esbuild.build({ ...shared, format: "iife", globalName: "Keylink", outfile: "dist/keylink.js" });
await esbuild.build({ ...shared, format: "esm", outfile: "dist/keylink.mjs" });
