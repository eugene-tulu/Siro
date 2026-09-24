export function createDashboardStream(req, res, eventBus) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      cleanup();
    }
  };

  const onSessionState = (data) => send("session_state", data);
  const onProductShowcase = (data) => send("product_showcase", data);
  const onAgentShowcase = (data) => send("agent_showcase", data);
  const onAgentResponse = (data) => send("agent_response", data);
  const onAgentIdlePrompt = (data) => send("agent_idle_prompt", data);
  const onBuyerEngaged = (data) => send("buyer_engaged", data);
  const onSaleMade = (data) => send("sale_made", data);
  const onCameraSwitch = (data) => send("camera_switch", data);
  const onStreamStarted = (data) => send("stream_started", data);
  const onStateChange = (data) => send("state", data);
  const onLog = (data) => send("log", data);
  const onChatDecision = (data) => send("chat_decision", data);
  const onJevDecision = (data) => send("jev_decision", data);
  const onBidRecorded = (data) => send("bid_recorded", data);
  const onBidRejected = (data) => send("bid_rejected", data);
  const onLivepeerResult = (data) => send("livepeer_result", data);
  const onAvatarRendered = (data) => send("avatar_rendered", data);
  const onAvatarScene = (data) => send("avatar_scene", data);
  const onCameraSwitchExtended = (data) => {
    if (data.angle === "avatar" || data.avatarId) {
      send("avatar_camera_switch", data);
    }
    send("camera_switch", data);
  };

  eventBus.on("session_state", onSessionState);
  eventBus.on("product_showcase", onProductShowcase);
  eventBus.on("agent_showcase", onAgentShowcase);
  eventBus.on("agent_response", onAgentResponse);
  eventBus.on("agent_idle_prompt", onAgentIdlePrompt);
  eventBus.on("buyer_engaged", onBuyerEngaged);
  eventBus.on("sale_made", onSaleMade);
  eventBus.on("camera_switch", onCameraSwitchExtended);
  eventBus.on("stream_started", onStreamStarted);
  eventBus.on("state_change", onStateChange);
  eventBus.on("log", onLog);
  eventBus.on("chat_decision", onChatDecision);
  eventBus.on("jev_decision", onJevDecision);
  eventBus.on("bid_recorded", onBidRecorded);
  eventBus.on("bid_rejected", onBidRejected);
  eventBus.on("livepeer_result", onLivepeerResult);
  eventBus.on("avatar_rendered", onAvatarRendered);
  eventBus.on("avatar_scene", onAvatarScene);

  send("session_state", { state: "connected", activeProduct: null });

  function cleanup() {
    eventBus.off("session_state", onSessionState);
    eventBus.off("product_showcase", onProductShowcase);
    eventBus.off("agent_showcase", onAgentShowcase);
    eventBus.off("agent_response", onAgentResponse);
    eventBus.off("agent_idle_prompt", onAgentIdlePrompt);
    eventBus.off("buyer_engaged", onBuyerEngaged);
    eventBus.off("sale_made", onSaleMade);
     eventBus.off("camera_switch", onCameraSwitchExtended);
    eventBus.off("stream_started", onStreamStarted);
    eventBus.off("state_change", onStateChange);
    eventBus.off("log", onLog);
    eventBus.off("chat_decision", onChatDecision);
    eventBus.off("jev_decision", onJevDecision);
    eventBus.off("bid_recorded", onBidRecorded);
    eventBus.off("bid_rejected", onBidRejected);
   eventBus.off("livepeer_result", onLivepeerResult);
   eventBus.off("avatar_rendered", onAvatarRendered);
   eventBus.off("avatar_scene", onAvatarScene);
}

  req.on("close", cleanup);
  req.on("error", cleanup);

  res.on("close", cleanup);
  res.on("error", cleanup);
}