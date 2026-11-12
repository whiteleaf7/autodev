// 画面に出ているウィンドウを JSON で出す。アプリのウィンドウが出たかを AI が確かめるために使う。
// 画面収録の許可がなくても、持ち主のプロセス・ID・位置と大きさは取れる（題名は許可があるときだけ入る）。
// ウィンドウの ID は `screencapture -l <id>` でそのウィンドウだけを撮るのに使える。
//
// 使い方: swift tools/verify/src/windows.swift [持ち主の名前に含まれる文字列]
import CoreGraphics
import Foundation

struct WindowInfo: Encodable {
  let id: Int
  let pid: Int
  let owner: String
  let title: String?
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

struct Output: Encodable {
  let screenCaptureAllowed: Bool
  let windows: [WindowInfo]
}

let ownerFilter = CommandLine.arguments.dropFirst().first?.lowercased()
let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
let entries = (raw as? [[String: Any]]) ?? []

let windows: [WindowInfo] = entries.compactMap { entry in
  guard
    let id = entry[kCGWindowNumber as String] as? Int,
    let pid = entry[kCGWindowOwnerPID as String] as? Int,
    let owner = entry[kCGWindowOwnerName as String] as? String,
    let layer = entry[kCGWindowLayer as String] as? Int, layer == 0,
    let bounds = entry[kCGWindowBounds as String] as? [String: CGFloat]
  else { return nil }
  if let ownerFilter, !owner.lowercased().contains(ownerFilter) { return nil }
  return WindowInfo(
    id: id,
    pid: pid,
    owner: owner,
    title: entry[kCGWindowName as String] as? String,
    x: Int(bounds["X"] ?? 0),
    y: Int(bounds["Y"] ?? 0),
    width: Int(bounds["Width"] ?? 0),
    height: Int(bounds["Height"] ?? 0)
  )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let output = Output(screenCaptureAllowed: CGPreflightScreenCaptureAccess(), windows: windows)
FileHandle.standardOutput.write(try encoder.encode(output))
print()
