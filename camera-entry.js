import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

window.NativeCamera = {
  getPhoto: (source, options = {}) => Camera.getPhoto({
    ...options,
    resultType: CameraResultType.Base64,
    source: source === 'PHOTOS' ? CameraSource.Photos : CameraSource.Camera,
    correctOrientation: true,
    quality: 95,
    width: 3000
  })
};
