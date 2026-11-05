const params = new URLSearchParams(location.search);
if (params.get("key") === "green") {
  document.body.classList.add("green");
  document.title = params.has("capture")
    ? "大肥鱼专用绿幕 · 直播伴侣捕获此窗口"
    : "大肥鱼绿幕 · 直播伴侣捕获此窗口";
}
if (params.has("preview")) document.body.classList.add("preview");
const bubble = document.getElementById("bubble"),
  note = document.getElementById("note");
let nextBalance = Date.now() + 210000,
  hideAt = 0,
  commentarySeq = 0,
  balanceSeq = 0,
  first = true,
  queuedBalance = false,
  queuedBalanceAt = 0,
  balanceShowingUntil = 0,
  waitingCommentary = null;
let overlayVersion = null;
let baseText = '', reactionText = '', reactionUntil = 0, reactionSeq = 0, waitingReaction = null;
function show(text, duration) {
  baseText = text;
  bubble.textContent = text;
  bubble.classList.add("show");
  hideAt = Date.now() + duration;
}
async function poll() {
  try {
    const state = await (
      await fetch("/api/overlay", { cache: "no-store" })
    ).json();
    if (overlayVersion && state.overlayVersion && overlayVersion !== state.overlayVersion) {
      location.reload();
      return;
    }
    overlayVersion = state.overlayVersion || overlayVersion;
    document.body.style.visibility = state.streamingEnabled ? 'visible' : 'hidden';
    if (!state.streamingEnabled) return;
    note.textContent = state.note;
    document.getElementById('stage-goal').textContent = state.goal || '正在确定下一阶段目标';
    if (state.contextCompacting) {
      show('正在压缩上下文',1500);
      waitingCommentary=null;waitingReaction=null;reactionUntil=0;
      balanceShowingUntil=0;queuedBalance=false;
      return;
    }
    if(state.reaction && state.reaction.seq!==reactionSeq){reactionSeq=state.reaction.seq;waitingReaction=state.reaction;}
    if (first) {
      balanceSeq = state.balanceBubbleSeq;
      first = false;
    }
    if (state.balanceBubbleSeq !== balanceSeq) {
      balanceSeq = state.balanceBubbleSeq;
      queuedBalance = true;
      queuedBalanceAt = 0;
    }
    if (Date.now() >= nextBalance) {
      if(!queuedBalance)queuedBalanceAt=Date.now();
      queuedBalance = true;
      const min = state.bubble.minSeconds * 1000,
        max = state.bubble.maxSeconds * 1000;
      nextBalance = Date.now() + min + Math.random() * (max - min);
    }
    if (state.commentary && state.commentary.seq !== commentarySeq) {
      commentarySeq = state.commentary.seq;
      if (state.commentary.action === "preview") {
        show(state.commentary.text, 15000);
        balanceShowingUntil = 0;
        queuedBalance = false;
        waitingCommentary = null;
        waitingReaction=null;reactionText='';reactionUntil=0;
      } else waitingCommentary = state.commentary;
    }
    if (queuedBalance && (Date.now() >= hideAt || Date.now()-queuedBalanceAt>=12000) && state.balance) {
      queuedBalance = false;
      show(
        "账户余粮 ¥" + Number(state.balance.total).toFixed(2),
        state.bubble.durationSeconds * 1000,
      );
      balanceShowingUntil = hideAt;
    } else if(waitingCommentary && Date.now()>=balanceShowingUntil){
      if(Date.now()-waitingCommentary.at<20000)show(waitingCommentary.text,Math.min(12000,Math.max(4000,2500+[...waitingCommentary.text].length*180)));
      waitingCommentary=null;
    }
    if(waitingReaction && Date.now()>=balanceShowingUntil){
      if(Date.now()-waitingReaction.at<16000){reactionText=waitingReaction.text;reactionUntil=Date.now()+Math.min(8000,Math.max(4000,1800+[...reactionText].length*160));}
      waitingReaction=null;
    }
    const showReaction=Date.now()<reactionUntil&&Date.now()>=balanceShowingUntil;
    if(showReaction)hideAt=Math.max(hideAt,reactionUntil);
    bubble.textContent=showReaction?reactionText+'\n'+baseText:baseText;
    if (Date.now() >= hideAt) bubble.classList.remove("show");
  } catch {
    if (Date.now() >= hideAt) bubble.classList.remove("show");
  }
}
await poll();
setInterval(poll, 700);
