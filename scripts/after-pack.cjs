const { execFileSync } = require("node:child_process");
const { copyFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const root = join(dirname(__filename), "..");
const quickLookContentTypes = [
  "public.markdown",
  "net.daringfireball.markdown",
  "net.ia.markdown",
  "io.typora.markdown",
  "com.unknown.md",
];

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function setPlistString(plistPath, keyPath, value) {
  run("plutil", ["-replace", keyPath, "-string", value, plistPath]);
}

function setPlistJson(plistPath, keyPath, value) {
  run("plutil", ["-replace", keyPath, "-json", JSON.stringify(value), plistPath]);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appInfo = context.packager.appInfo;
  const appId = appInfo.id || "com.markedly.app";
  const appPath = join(context.appOutDir, `${appInfo.productFilename}.app`);
  const extensionPath = join(
    appPath,
    "Contents",
    "PlugIns",
    "PreviewExtension.appex",
  );
  const resourcesPath = join(extensionPath, "Contents", "Resources");
  const plistPath = join(extensionPath, "Contents", "Info.plist");
  const quickLookDist = join(root, "dist", "quicklook");

  if (!existsSync(extensionPath)) {
    throw new Error(`Quick Look extension was not copied to ${extensionPath}`);
  }
  if (!existsSync(quickLookDist)) {
    throw new Error("Run npm run build:quicklook before packaging.");
  }

  for (const file of ["preview.html", "preview.css", "preview.js"]) {
    copyFileSync(join(quickLookDist, file), join(resourcesPath, file));
  }

  setPlistString(plistPath, "CFBundleIdentifier", `${appId}.PreviewExtension`);
  setPlistString(plistPath, "CFBundleDisplayName", "Markedly Quick Look");
  setPlistString(plistPath, "CFBundleName", "Markedly Quick Look");
  setPlistString(plistPath, "QLJS.pagePath", "preview.html");
  setPlistString(plistPath, "QLJS.preferredContentSize", "{760,900}");
  setPlistJson(
    plistPath,
    "NSExtension.NSExtensionAttributes.QLSupportedContentTypes",
    quickLookContentTypes,
  );

  const entitlementsPath = join(
    root,
    "node_modules",
    "quicklookjs",
    "dist",
    "PreviewExtension.entitlements",
  );
  const signingIdentity = process.env.CSC_NAME || "-";
  run("codesign", [
    "--sign",
    signingIdentity,
    "--force",
    "--entitlements",
    entitlementsPath,
    extensionPath,
  ]);
};
