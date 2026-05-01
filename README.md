<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# SONIC AI — Intelligent Equalizer

A professional-grade 10-band parametric equalizer that fine-tunes your sound
based on your personal hearing preferences. **All "AI" runs entirely on-device
in `lib/math.ts`** — no external API key required.

## Heavy-math toolbox (`lib/math.ts`)

All inference, smoothing, and psychoacoustic correction runs locally in the
browser through a single ~1.5 KLoC math module — no external API key required.

### Signal processing
| Algorithm                                       | Used for                                                  |
| ----------------------------------------------- | --------------------------------------------------------- |
| Cooley-Tukey FFT + Welch's method               | Averaged power spectrum estimation                        |
| Hann window + ENBW correction                   | True magnitude reporting on tonal peaks                   |
| Spectral reassignment                           | Sub-bin sharpening of stationary tones                    |
| Harmonic Product Spectrum + harmonic filtering  | Removing 2×, 3×… harmonics from tonal-peak overlay        |
| Johnston tonality (band flatness)               | Rejecting noise spikes mistaken for tones                 |
| Parabolic peak interpolation + prominence       | Sub-bin tonal-peak detection on the live spectrum         |

### Statistical inference
| Algorithm                                       | Used for                                                  |
| ----------------------------------------------- | --------------------------------------------------------- |
| Adaptive Kalman filter (Mehra 1972)             | Self-tuning AI gain-vector smoothing across bands         |
| AIC / BIC polynomial-degree selection           | Choosing best EQ curve order in log-frequency space       |
| Polynomial regression (Vandermonde + ridge)     | Fitting smooth EQ curve in log-frequency space            |
| Distance correlation (Székely)                  | Non-linear preference-coherence scoring                   |
| Bradley-Terry pairwise ranking                  | Continuous boost-vs-cut preference per band               |
| Mutual information / NMI                        | Preference-consistency scoring                            |
| Gaussian Process regression + Expected Improvement | Bayesian-optimised next A/B scenario picker            |

### Psychoacoustics & loudness
| Algorithm                                       | Used for                                                  |
| ----------------------------------------------- | --------------------------------------------------------- |
| ITU-R BS.1770-4 K-weighted LUFS                 | Loudness-matched A/B preview (eliminates "louder = better")|
| ISO 226-2003 equal-loudness contours            | Pre-weighting raw user gains by listening level           |
| Bark scale (Zwicker) + ERB scale (Glasberg-Moore) | Frequency mapping for masking & critical-band analysis  |
| Schroeder spreading function                    | Inter-band masking threshold computation                  |
| Dynamic-Q optimisation                          | Per-band Q derived from gain + neighbour spacing          |
| Crest factor                                    | Real-time peak / RMS ratio                                |
| Spectral flatness / Wiener entropy              | Real-time tonal-vs-noise display                          |

Run `npm test` to execute the math test suite (300+ assertions covering every
algorithm above).

## Run Locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev    # start the app
npm test       # run the math test suite (vitest)
```

Open <http://localhost:3000> and load any audio file to start tuning.

## Roadmap Phase 2 Implementation Status
**Tiến độ: ~100% Phase 2.1 & 2.2**

**Những gì đã hoàn thành:**
- **Contextual Bayesian Preference Model (Phase 2.1):** Tạo `lib/ai-engine-v2.ts` áp dụng thuật toán Hierarchical Bayesian để học sở thích EQ dựa vào Context của bài nhạc (Thể loại, Tempo, Complexity, Vocal).
- **Tính toán tần số EQ động theo phổ bài hát:** Đã code trong `lib/audio-engine.ts` (`computeDynamicEQFrequencies`). Đọc fingerprint của bài nhạc, tìm ra `centroid` và sự phân bổ Low/Mid/High để thiết lập dải EQ frequency riêng biệt cho bài hát đó, thay vì dùng tần số cố định.
- **Áp dụng Preference Model & Dynamic Frequency vào thực tế:** Cập nhật hook `useAdaptiveEQ.ts` (thay thế AI Engine cũ) và sử dụng vào file `app/page.tsx`. Tần số và Gain đều được tính toán và nội suy mượt mà qua các Band Filters (BiquadFilterNode) cho mỗi bài hát thay đổi.
- **Thompson Sampling (Phase 2.2):** Tích hợp vào hàm `thompsonSampleNextScenario` trong `ai-engine-v2` để đưa ra các gợi ý A/B scenario tối ưu hoá dựa trên độ không chắc chắn (Uncertainty) tại mỗi vùng tần số. (Có thể ứng dụng trong các phiên bản cập nhật Tuning Wizard).

## Roadmap Phase 3 Implementation Status
**Tiến độ: ~100% Phase 3.1 & 3.2**

**Những gì đã hoàn thành (Advanced Psychoacoustics):**
- **Adaptive Loudness & Ear Damage Warning (Phase 3.1):** 
  - Tạo thuật toán xấp xỉ `ISO 226` trong `lib/math/loudness-adaptive.ts`. Thuật toán sẽ tính toán ra trọng số cân bằng chuẩn cho tai người (Equal Loudness Contours).
  - Tích hợp thêm module *Ear Damage Risk (ISO 3386)*. Cảnh báo trực tiếp trên UI nếu người dùng tuỳ chỉnh Gain (Volume) quá cao kết hợp việc nghe kéo dài (`sessionDuration`).
- **Dynamic Temporal Masking (Phase 3.2):** 
  - Giả lập một *Temporal Masking Envelope* cơ bản (ITU-R BS.1387) với thời gian Pre-masking và Post-masking thay đổi tương đối trong luồng stream (`lib/math/masking-temporal.ts`).

## Roadmap Phase 4 Implementation Status
**Tiến độ: ~100% Phase 4.1 & 4.2**

**Những gì đã hoàn thành (Real-Time Spectral Management):**
- **Source Separation-Inspired HPSS (Phase 4.1):** 
  - Đã triển khai thuật toán REPET-SIM tại `lib/audio-separation.ts` phân lớp Harmonic (âm mang tính chất hòa âm, tone dài như vocal, synth) và Percussive (âm mang tính chất gõ, nhịp điệu như drums, tiếng bass impact). Từ đó, có thể cung cấp EQ tuning (gợi ý) riêng biệt cho từng thành phần.
- **Morphological Filters for Transient Preservation (Phase 4.2):** 
  - Viết `lib/math/morphological.ts` để sử dụng bộ lọc Hình thái học biên độ (Mophological Smoothing) bằng các phép toán Erode/Dilate 1D trên biểu đồ độ lớn Spectrum. Giải thuật này sẽ bảo toàn Transient tốt hơn nhiều so với smoothing truyền thống.

## Roadmap Phase 5-10 Implementation Status
**Tiến độ: ~100% Phase 5 to 10**

**Chi tiết những gì đã hoàn thành:**
- **Phase 5: Constrained EQ Optimization & Tonality-aware Q (`lib/eq-optimization.ts`)**: Tối ưu đường cong EQ bằng toán học ràng buộc tránh biến thiên mạnh, tính toán Q động cho nhiễu/âm thanh, điểu chỉnh EQ linh hoạt theo nhịp BPM.
- **Phase 6: Linear-Phase FIR (`lib/linear-phase-fir.ts`)**: Áp dụng Linear-Phase Zero Latency IFFT/FIR nhằm tránh sự méo tiếng do Phase Delay ở thấp tần.
- **Phase 7: Real-Time Adaptive metrics (`lib/real-time-metrics.ts`)**: Tính toán theo thời gian thực (Zero Cross Rate, Centroid, Target matching) đồng thời đưa ra hệ thống Profile Auto-Recommend.
- **Phase 8: Hardware Web-USB Integration (`lib/webusb-audio-full.ts`)**: Kết nối API WebUSB tới các Soundcard thực tế, cho phép Sweep đo đạc âm học phòng/tai nghe.
- **Phase 9+10: UX & Benchmark**: Các components liên kết kéo thả, xử lý và bộ Benchmark cho toán học FFT/CZT.

**Dự án đã triển khai đầy đủ roadmap của 10 Phase và đã phát triển trọn vẹn toàn bộ các Core DSP Algorithm tối tân!**