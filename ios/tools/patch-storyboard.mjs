import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(TOOLS, '..');
const ROOT = path.join(IOS, 'App', 'App');
const MAIN = path.join(ROOT, 'Base.lproj', 'Main.storyboard');
const BACKUP = path.join(ROOT, 'Base.lproj', 'Main.storyboard.orig.xml');

const STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0"
          toolsVersion="22505" targetRuntime="iOS.CocoaTouch" useAutolayout="YES"
          initialViewController="B8D-0N-5wS">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <plugin identifier="org.capacitor.ios.wkwebview" version="1.0"/>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="22504"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--Bridge View Controller-->
        <scene sceneID="4Xj-7H-pVf">
            <objects>
                <viewController id="B8D-0N-5wS" customClass="CAPBridgeViewController" customModule="App"
                                customModuleProvider="target" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="kMw-Ub-hKq">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <color key="backgroundColor" red="0.0196" green="0.0274" blue="0.0510" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <edgeInsets key="layoutMargins" top="0.0" left="0.0" bottom="0.0" right="0.0"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="3d0-5Q-5tL" userLabel="First Responder" customClass="UIResponder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
</document>
`;

if (fs.existsSync(path.dirname(MAIN))) {
  if (!fs.existsSync(BACKUP) && fs.existsSync(MAIN)) {
    fs.copyFileSync(MAIN, BACKUP);
    console.log('[patch-storyboard] backed up original Main.storyboard');
  }
  fs.writeFileSync(MAIN, STORYBOARD, 'utf8');
  console.log('[patch-storyboard] wrote Base.lproj/Main.storyboard (CAPBridgeViewController)');
} else {
  console.log('[patch-storyboard] Main storyboard not present; skipped');
}
