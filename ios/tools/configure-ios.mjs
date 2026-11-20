import fs from 'node:fs';

const CONFIG = new URL('../capacitor.config.json', import.meta.url);
const APP = new URL('../ios/App/App', import.meta.url);

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const splashPage = 'splash.html';

// ---------------------------------------------------------------------------
// 1. Launch screen: point it at the animated intro instead of a static image
// ---------------------------------------------------------------------------
function patchPlist(file) {
  if (!fs.existsSync(file)) {
    console.warn('[configure-ios] plist not found yet:', file.pathname);
    return;
  }
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  // App shows its own animated intro -> no native splash image needed.
  s = s.replace(/<key>UILaunchStoryboardName<\/key>\s*<string>[^<]*<\/string>/g, '');

  // Allow the CDN + Firebase + Telegram hosts the pages talk to.
  if (!s.includes('<key>NSAppTransportSecurity</key>')) {
    s = s.replace('</dict>\n</plist>',
      '\t<key>NSAppTransportSecurity</key>\n\t<dict>\n' +
      '\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n' +
      '\t</dict>\n\t' +
      '<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n' +
      '</dict>\n</plist>');
  }

  // Camera + photos (KYC upload) usage strings - required or iOS kills the app.
  const usage = [
    ['NSCameraUsageDescription', 'Take a photo of your ID for verification.'],
    ['NSPhotoLibraryUsageDescription', 'Select a photo of your ID for verification.'],
  ];
  for (const [key, value] of usage) {
    if (!s.includes('<key>' + key + '</key>')) {
      s = s.replace('</dict>\n</plist>',
        '\t<key>' + key + '</key>\n\t<string>' + value + '</string>\n</dict>\n</plist>');
    }
  }

  if (s !== before) {
    fs.writeFileSync(file, s, 'utf8');
    console.log('[configure-ios] patched ' + file.pathname);
  } else {
    console.log('[configure-ios] plist already up to date');
  }
}

// ---------------------------------------------------------------------------
// 2. AppIcon set: copy the generated PNGs into Assets.xcassets
// ---------------------------------------------------------------------------
function copyIcons() {
  const src = new URL('../icons/', import.meta.url);
  const dst = new URL('Assets.xcassets/AppIcon.appiconset/', APP);
  if (!fs.existsSync(src)) {
    console.warn('[configure-ios] icons/ missing - run python ios/tools/make_ios_icons.py first');
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.png') && f !== 'Contents.json') continue;
    fs.copyFileSync(new URL(f, src), new URL(f, dst));
  }
  console.log('[configure-ios] AppIcon set copied (' + fs.readdirSync(dst).length + ' files)');
}

// ---------------------------------------------------------------------------
// 3. Launch storyboard background colour (dark, no white flash)
// ---------------------------------------------------------------------------
function patchColor(file) {
  if (!fs.existsSync(file)) return;
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(/red="[\d.]+" green="[\d.]+" blue="[\d.]+"/,
                'red="0.0196" green="0.0274" blue="0.0510"');
  if (s !== before) {
    fs.writeFileSync(file, s, 'utf8');
    console.log('[configure-ios] launch colour set to #05070D');
  }
}

const PBX = new URL('../App.xcodeproj/project.pbxproj', APP);
if (fs.existsSync(PBX)) {
  let p = fs.readFileSync(PBX, 'utf8');
  p = p.replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;');
  fs.writeFileSync(PBX, p, 'utf8');
  console.log('[configure-ios] deployment target set to iOS 16.0');
}

// Keep the generated launch storyboard; patch only its colour.

patchPlist(new URL('Info.plist', APP));
patchColor(new URL('Base.lproj/LaunchScreen.storyboard', APP));
copyIcons();
console.log('[configure-ios] done (start page: ' + splashPage + ')');
