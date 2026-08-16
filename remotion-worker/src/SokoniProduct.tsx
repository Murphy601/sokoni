import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type SokoniProductProps = {
  imageUrls: string[];
  creamBg?: string;
  secondsPerSlide?: number;
};

const Slide: React.FC<{ src: string; creamBg: string }> = ({ src, creamBg }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.28], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(
    frame,
    [0, 8, Math.max(9, durationInFrames - 8), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: creamBg, justifyContent: "center", alignItems: "center" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `scale(${scale})`,
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};

export const SokoniProduct: React.FC<SokoniProductProps> = ({
  imageUrls = [],
  creamBg = "#FFF8F0",
  secondsPerSlide = 2,
}) => {
  const { fps } = useVideoConfig();
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 8);
  const per = Math.max(1, Math.round(Number(secondsPerSlide) || 2));
  const framesPerSlide = Math.max(fps, per * fps);

  if (!urls.length) {
    return <AbsoluteFill style={{ backgroundColor: creamBg }} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: creamBg }}>
      {urls.map((src, i) => (
        <Sequence key={`${i}-${src}`} from={i * framesPerSlide} durationInFrames={framesPerSlide}>
          <Slide src={src} creamBg={creamBg} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
