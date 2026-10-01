import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const clipboardText = async () =>
  (await execute("pbpaste", [], {maxBuffer: 1024 * 1024})).stdout;
export const clearClipboardForTest = async () => {
  await execute("osascript", ["-e", 'set the clipboard to "Userscripts clipboard test pending"']);
};

// Keep every native pasteboard item's typed data in memory, not a file.
// Restore rich text/images as well as text even when the child test fails.
export async function withMacClipboard(command, args) {
  if (process.platform !== "darwin")
    throw new Error("Clipboard regression currently requires macOS");
  const script = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function run() {
  const board=$.NSPasteboard.generalPasteboard;
  const original=board.pasteboardItems, saved=$.NSMutableArray.alloc.init;
  for(let i=0;i<original.count;i++) {
    const source=original.objectAtIndex(i), copy=$.NSPasteboardItem.alloc.init;
    const types=source.types;
    for(let j=0;j<types.count;j++) {
      const type=types.objectAtIndex(j), data=source.dataForType(type);
      if(!copy.setDataForType(data,type)) throw new Error('Cannot back up a clipboard data type');
    }
    saved.addObject(copy);
  }
  try {
    const task=$.NSTask.alloc.init, output=$.NSPipe.pipe;
    task.launchPath=$(${JSON.stringify(command)});
    task.arguments=$(${JSON.stringify(args)});
    task.standardOutput=output;
    task.standardError=output;
    task.launch;
    const data=output.fileHandleForReading.readDataToEndOfFile;
    task.waitUntilExit;
    const text=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding));
    if(task.terminationStatus!==0) throw new Error(text);
    return text;
  } finally {
    board.clearContents;
    if(saved.count && !board.writeObjects(saved)) throw new Error('Clipboard restoration failed');
  }
}`;
  const result = await execute("osascript", ["-l", "JavaScript", "-e", script], {maxBuffer: 1024 * 1024});
  return result.stdout;
}
