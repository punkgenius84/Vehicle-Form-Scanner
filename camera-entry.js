import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
window.NativeCamera = { getPhoto: (options = {}) => Camera.getPhoto({ ...options, resultType: CameraResultType.Base64, source: CameraSource.Camera }) };
