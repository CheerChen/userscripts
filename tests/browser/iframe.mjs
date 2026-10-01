// Bounded child-target evaluation for cross-site browser fixtures. Detach even
// on failure, and do not emit frame URLs or page content in diagnostics.
export async function inIframe({space, label, path, expression}) {
  const task = await taskSpace(space), page = task.page(label);
  await page.url();
  const deadline = Date.now() + 15000;
  let target;
  while (Date.now() < deadline) {
    target = (await task.cdp("Target.getTargets")).targetInfos.find(target =>
      target.type === "iframe" && target.parentId === page.targetId &&
      new URL(target.url).pathname.startsWith(path));
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!target) throw new Error("Cross-site fixture target not found");
  const {sessionId} = await page.cdp("Target.attachToTarget", {targetId: target.targetId, flatten: false});
  try {
    const id = 401;
    await page.cdp("Target.sendMessageToTarget", {sessionId, message: JSON.stringify({
      id, method: "Runtime.evaluate", params: {expression, awaitPromise: true, returnByValue: true},
    })});
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const event = (await page.events()).find(event => event.method === "Target.receivedMessageFromTarget" &&
        event.params.sessionId === sessionId && JSON.parse(event.params.message).id === id);
      if (event) {
        const response = JSON.parse(event.params.message);
        if (response.error || response.result?.exceptionDetails) throw new Error("Cross-site fixture evaluation failed");
        return response.result.result.value;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Cross-site fixture evaluation timed out");
  } finally {
    await page.cdp("Target.detachFromTarget", {sessionId});
  }
}
