<template>
<div class="studio-page" data-test="Studio">
  <div id="display" class="split-area">
    <div class="studio-mode-container" ref="studioModeContainer" :class="{ stacked }">
      <studio-mode-controls v-if="studioMode" :stacked="stacked" />
      <div
        class="studio-display-container"
        :class="{ stacked }">
        <studio-editor v-if="previewEnabled" class="studio-output-display" />
        <div v-if="studioMode" class="studio-mode-display-container">
          <display class="studio-mode-display" :paddingSize="10" />
        </div>
      </div>
    </div>
    <div v-if="!previewEnabled" class="no-preview">
      <div class="message">
        {{ $t('scenes.previewIsDisabledInPerformanceMode') }}
        <div class="button button--action button--sm" @click="enablePreview">{{ $t('scenes.disablePerformanceMode') }}</div>
      </div>
    </div>
  </div>
  <div id="control" class="split-area">
    <studio-controls />
  </div>
</div>
</template>

<script lang="ts" src="./Studio.vue.ts"></script>

<style lang="less">
/* scoped を付けると split.js が自動的に付けるclass名と一致しなくなるため */
.gutter {
    background-color: #eee;

    background-repeat: no-repeat;
    background-position: 50%;
}

.gutter.gutter-vertical {
    background-image:  url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAFAQMAAABo7865AAAABlBMVEVHcEzMzMzyAv2sAAAAAXRSTlMAQObYZgAAABBJREFUeF5jOAMEEAIEEFwAn3kMwcB6I2AAAAAASUVORK5CYII=');
    cursor: row-resize;
}
</style>

<style lang="less" scoped>
@import '../../styles/index';

.studio-page {
  display: flex;
  flex-direction: column;
}

.split-area {
  flex-grow: 1;
  display: flex;
  width: 100%;
  flex-direction: column;
}

.studio-mode-container {
  flex-grow: 1;
  display: flex;
  flex-direction: column;

  &.stacked {
    flex-direction: row;
  }
}

.studio-display-container {
  flex-grow: 1;
  display: flex;

  &.stacked {
    flex-direction: column;
  }
}

.studio-mode-display-container {
  flex-grow: 1;
  position: relative;
}

.studio-mode-display {
  position: absolute;
  width: 100%;
  height: 100%;
}

.no-preview {
  position: relative;
  flex-grow: 1;
  background-color: @padding-color;
  display: flex;
  align-items: center;
  justify-content: center;

  .message {
    max-width: 50%;
    .button {
      margin-top: 20px;
      display: block;
    }
  }
}
</style>
