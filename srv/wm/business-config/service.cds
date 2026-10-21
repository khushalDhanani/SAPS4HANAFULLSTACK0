namespace saps4hana.wm;

using { saps4hana.wm as wm } from '../../../db/wm/business-config';

@path: '/odata/v4/business-config'
@requires: 'authenticated-user'
service BusinessConfigService {
    @restrict: [
        { grant: 'READ', to: 'authenticated-user' },
        { grant: ['CREATE', 'UPDATE', 'DELETE', 'WRITE'], to: 'WMAdmin' }
    ]
    entity BusinessConfigs as projection on wm.BusinessConfig;
}
