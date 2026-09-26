report ZPK261
       no standard page heading line-size 255.

* Include bdcrecx1_s:
* The call transaction using is called WITH AUTHORITY-CHECK!
* If you have own auth.-checks you can use include bdcrecx1 instead.
include bdcrecx1_s.

start-of-selection.

perform open_group.

perform bdc_dynpro      using 'SAPLSPO4' '0300'.
perform bdc_field       using 'BDC_CURSOR'
                              'SVALD-VALUE(01)'.
perform bdc_field       using 'BDC_OKCODE'
                              '=FURT'.
perform bdc_field       using 'SVALD-VALUE(01)'
                              '1000'.
perform bdc_dynpro      using 'SAPLKPP0' '1000'.
perform bdc_field       using 'BDC_CURSOR'
                              'KPP0B-VALUE(09)'.
perform bdc_field       using 'BDC_OKCODE'
                              '=CSUB'.
perform bdc_field       using 'KPP1B-ONLY'
                              'X'.
perform bdc_field       using 'KPP0B-VALUE(01)'
                              '0'.
perform bdc_field       using 'KPP0B-VALUE(02)'
                              '10'.
perform bdc_field       using 'KPP0B-VALUE(03)'
                              '10'.
perform bdc_field       using 'KPP0B-VALUE(04)'
                              '2025'.
perform bdc_field       using 'KPP0B-VALUE(06)'
                              '1112240019'.
perform bdc_field       using 'KPP0B-VALUE(09)'
                              'PP_LAB'.
perform bdc_dynpro      using 'SAPLKPP2' '0112'.
perform bdc_field       using 'BDC_CURSOR'
                              'Z-BDC08(01)'.
perform bdc_field       using 'BDC_OKCODE'
                              '=CBUC'.
perform bdc_field       using 'Z-BDC08(01)'
                              '   290'.
perform bdc_transaction using 'KP26'.

perform close_group.