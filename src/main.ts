import './ui/style.css';
import { createGame } from './engine/game';
import { installHooks } from './engine/hooks';
import { BootScene } from './scenes/boot';
import { PickerScene } from './scenes/picker';
import { HubScene } from './scenes/hub';
import { SoonScene } from './scenes/soon';
import { TunerScene } from './scenes/tuner';
import { ModeChoiceScene } from './scenes/modechoice';
import { LevelSelectScene } from './scenes/levelselect';
import { PulsoScene } from './scenes/pulso';
import { ResultsScene } from './scenes/results';
import { CalibrationScene } from './scenes/calibration';

installHooks();
createGame(document.getElementById('app')!, [BootScene, PickerScene, HubScene, SoonScene, TunerScene, ModeChoiceScene, LevelSelectScene, PulsoScene, ResultsScene, CalibrationScene]);
