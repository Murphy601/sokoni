import React from "react";
import { Composition } from "remotion";
import { SokoniProduct, SokoniProductProps } from "./SokoniProduct";

const DEFAULT_PROPS: SokoniProductProps = {
  imageUrls: [],
  creamBg: "#FFF8F0",
  secondsPerSlide: 2,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SokoniProduct"
        component={SokoniProduct}
        durationInFrames={120}
        fps={30}
        width={720}
        height={720}
        defaultProps={DEFAULT_PROPS}
        calculateMetadata={({ props }) => {
          const urls = (props.imageUrls || []).filter(Boolean).slice(0, 8);
          const per = Math.max(1, Math.round(Number(props.secondsPerSlide) || 2));
          const slides = Math.max(1, urls.length || 1);
          return {
            durationInFrames: Math.max(30, slides * per * 30),
            props,
          };
        }}
      />
    </>
  );
};
