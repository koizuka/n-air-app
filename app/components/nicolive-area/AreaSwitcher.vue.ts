import { Inject } from 'services/core/injector';
import { CustomizationService } from 'services/customization';
import Vue from 'vue';
import Popper from 'vue-popperjs';
import { Component, Prop } from 'vue-property-decorator';

interface IArea {
  name: string;
  slotName: string;
  defaultSelected?: boolean;
}

@Component({
  components: { Popper },
})
export default class AreaSwitcher extends Vue {
  @Prop()
  contents: IArea[];

  @Inject()
  private customizationService: CustomizationService;

  get compactMode(): boolean {
    return this.customizationService.state.compactMode;
  }

  private selectedContent: IArea = this.contents.find(c => c.defaultSelected) ?? this.contents[0];

  get activeContent(): IArea {
    return this.compactMode ? this.contents[0] : this.selectedContent;
  }

  select(slotName: string) {
    this.selectedContent = this.contents.find(c => c.slotName === slotName)!;
  }
}
