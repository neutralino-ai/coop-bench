import UIKit
import Speech
import AVFoundation

/// A temporary reason draft. Audio is never stored or submitted to the game service.
@MainActor final class ReasonDictation {
    private var continuation: CheckedContinuation<String,Error>?
    private var engine: AVAudioEngine?,request: SFSpeechAudioBufferRecognitionRequest?,task: SFSpeechRecognitionTask?
    private var dialog: UIAlertController?,timer: Timer?,observer: NSObjectProtocol?
    private var transcript="",installedTap=false,starting=false
    private var generation=UUID()

    func start(from view: UIView) async throws -> String {
        try require(!starting && continuation == nil,"正在语音输入，请先完成本次输入。")
        starting=true;defer { starting=false }
        let speech=await withCheckedContinuation { done in SFSpeechRecognizer.requestAuthorization { done.resume(returning:$0) } }
        try require(speech == .authorized,"请在 iOS 设置中允许语音识别，或直接键入理由。")
        let microphone=await withCheckedContinuation { done in AVAudioApplication.requestRecordPermission { done.resume(returning:$0) } }
        try require(microphone,"请在 iOS 设置中允许麦克风，或直接键入理由。")
        try Task.checkCancellation()
        guard let recognizer=SFSpeechRecognizer(locale:Locale(identifier:"zh-CN")),recognizer.isAvailable else { throw ClientFailure("SPEECH_UNAVAILABLE","中文语音识别暂不可用，请直接键入理由。") }
        guard let root=view.window?.rootViewController else { throw ClientFailure("SPEECH_UNAVAILABLE","请重新打开玩家页面。") }
        var presenter=root;while let next=presenter.presentedViewController { presenter=next }
        return try await withCheckedThrowingContinuation { done in
            continuation=done;transcript="";generation=UUID();let current=generation
            let alert=UIAlertController(title:"说说你的理由",message:"正在听…\n文字只写入草稿，确认动作后才提交。",preferredStyle:.alert)
            let adopt=UIAlertAction(title:"采用文字",style:.default){[weak self] _ in self?.finish(adopt:true)};adopt.isEnabled=false
            alert.addAction(UIAlertAction(title:"取消",style:.cancel){[weak self] _ in self?.finish(adopt:false)});alert.addAction(adopt);dialog=alert
            presenter.present(alert,animated:true)
            observer=NotificationCenter.default.addObserver(forName:UIApplication.willResignActiveNotification,object:nil,queue:.main){[weak self] _ in Task { @MainActor in guard let self,self.generation == current else { return };self.finish(adopt:false) } }
            do {
                let session=AVAudioSession.sharedInstance();try session.setCategory(.record,mode:.measurement,options:.duckOthers);try session.setActive(true,options:.notifyOthersOnDeactivation)
                let audio=AVAudioEngine(),req=SFSpeechAudioBufferRecognitionRequest();engine=audio;request=req;req.shouldReportPartialResults=true
                if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition=true }
                let input=audio.inputNode,format=input.outputFormat(forBus:0)
                try require(format.sampleRate>0 && format.channelCount>0,"麦克风暂不可用。")
                input.installTap(onBus:0,bufferSize:1024,format:format){buffer,_ in req.append(buffer)};installedTap=true
                task=recognizer.recognitionTask(with:req){[weak self] result,error in
                    Task { @MainActor in
                        guard let self,self.continuation != nil,self.generation == current else { return }
                        if let result { self.transcript=String(result.bestTranscription.formattedString.prefix(1200));alert.message=self.transcript;adopt.isEnabled = !self.transcript.isEmpty }
                        if error != nil || result?.isFinal == true { self.stopAudio();alert.title=self.transcript.isEmpty ? "未识别到语音":"检查识别文字";if self.transcript.isEmpty { alert.message="请取消后重试，或直接键入理由。" } }
                    }
                }
                audio.prepare();try audio.start()
                timer=Timer.scheduledTimer(withTimeInterval:55,repeats:false){[weak self] _ in Task { @MainActor in guard let self,self.generation == current else { return };self.stopAudio();self.dialog?.title="检查识别文字" } }
            } catch { finish(adopt:false,error:publicFailure(error)) }
        }
    }
    private func stopAudio(){
        timer?.invalidate();timer=nil
        if let engine { engine.stop();if installedTap { engine.inputNode.removeTap(onBus:0) } };installedTap=false;engine=nil
        request?.endAudio();request=nil
        try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
    }
    private func finish(adopt: Bool,error: Error?=nil){
        guard let done=continuation else { return };continuation=nil;generation=UUID()
        stopAudio();task?.cancel();task=nil
        if let observer { NotificationCenter.default.removeObserver(observer) };observer=nil
        dialog?.dismiss(animated:true);dialog=nil
        if let error { done.resume(throwing:error) } else { done.resume(returning:adopt ? transcript:"") };transcript=""
    }
}
