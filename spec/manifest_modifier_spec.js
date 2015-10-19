goog.require('shaka.vimond.dash.ManifestTextPreprocessor');

describe('ManifestTextPreprocessor', function() {
    'use strict';

    var testdata = '<?xml version="1.0" encoding="UTF-8"?>\n<MPD\nxmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n\nxmlns="urn:mpeg:dash:schema:mpd:2011"\n\nxmlns:xlink="http://www.w3.org/1999/xlink"\n\nxmlns:cenc="urn:mpeg:cenc:2013"\nxsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011 http://standards.iso.org/ittf/PubliclyAvailableStandards/MPEG-DASH_schema_files/DASH-MPD.xsd"\nprofiles="urn:mpeg:dash:profile:isoff-live:2011"\ntype="static"\nmediaPresentationDuration="PT52M52.51S"\nminBufferTime="PT1.5S">\n<ProgramInformation>\n<Title>900012_ps66920_pd3171590.smil</Title>\n</ProgramInformation>\n<Period id="0" start="PT0.0S">\n<AdaptationSet id="0" mimeType="video/mp4" maxWidth="1280" maxHeight="720" par="16:9" frameRate="25" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">\n<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="c03ec8a3-cd66-4abf-b9d0-3883b4bb717a"/>\n<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" value="Widevine"/>\n<SegmentTemplate timescale="90000" media="chunk_ctvideo_cfm4s_rid$RepresentationID$_cs$Time$_mpd.m4s" initialization="chunk_ctvideo_cfm4s_rid$RepresentationID$_cinit_mpd.m4s">\n<SegmentTimeline>\n<S t="5940000" d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="45900"/>\n<S d="0"/>\n</SegmentTimeline>\n</SegmentTemplate>\n<Representation id="p0a0r0" codecs="avc1.4d001f" width="768" height="432" sar="1:1" bandwidth="2361000" />\n<Representation id="p0a0r1" codecs="avc1.4d001f" width="1280" height="720" sar="1:1" bandwidth="3119000" />\n<Representation id="p0a0r2" codecs="avc1.4d001f" width="768" height="432" sar="1:1" bandwidth="1745000" />\n<Representation id="p0a0r3" codecs="avc1.42001f" width="640" height="360" sar="1:1" bandwidth="1175000" />\n<Representation id="p0a0r4" codecs="avc1.42001e" width="640" height="360" sar="1:1" bandwidth="741000" />\n</AdaptationSet>\n<AdaptationSet id="1" mimeType="audio/mp4" lang="eng" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">\n<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="c03ec8a3-cd66-4abf-b9d0-3883b4bb717a"/>\n<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" value="Widevine"/>\n<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>\n<SegmentTemplate timescale="90000" media="chunk_ctaudio_cfm4s_rid$RepresentationID$_cs$Time$_mpd.m4s" initialization="chunk_ctaudio_cfm4s_rid$RepresentationID$_cinit_mpd.m4s">\n<SegmentTimeline>\n<S t="5940000" d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="180000"/>\n<S d="45900"/>\n</SegmentTimeline>\n</SegmentTemplate>\n<Representation id="p0a1r0" codecs="mp4a.40.2" audioSamplingRate="22050" bandwidth="126000">\n<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>\n</Representation>\n</AdaptationSet>\n</Period>\n</MPD>\n';

    var codecReplacement = {
            match: /("avc1\.4d001f")+/g,
            replacement: '"avc1.4d401f"'
        },
        emptySegmentRemoval = {
            match: '<S.*d="0".*\/>',
            options: 'g',
            replacement: ' '
        },
        emptySegmentToBeRemoved = '<S d="0"/>';
        //presentationTimeOffsetAttribute = 'presentationTimeOffset""';

    function isValidXml(str) {
        var domParser = new DOMParser();
        var parsed = domParser.parseFromString(str, 'application/xml');
        return parsed.documentElement.nodeName != 'parsererror';
    }
    
    describe('process', function() {
        it('leaves the manifest unchanged when no regonized configuration is set', function(){
            var modifier = new shaka.vimond.dash.ManifestTextPreprocessor();
            expect(modifier.process(testdata)).toBe(testdata);
        });
        
        it('replaces a codec entry with another one', function(){
            var modifier = new shaka.vimond.dash.ManifestTextPreprocessor({ replacements: [codecReplacement]});
            var processed = modifier.process(testdata);
            expect(processed).toContain(codecReplacement.replacement);
            expect(isValidXml(processed)).toBe(true);
        });

        it('removes a segment element, and accepts replacement regex specified as a string', function(){
            var modifier = new shaka.vimond.dash.ManifestTextPreprocessor({ replacements: [emptySegmentRemoval]});
            var processed = modifier.process(testdata);
            expect(processed).not.toContain(emptySegmentToBeRemoved);
            expect(isValidXml(processed)).toBe(true);
        });

        it('applies all replacements if more than one', function(){
            var modifier = new shaka.vimond.dash.ManifestTextPreprocessor({ replacements: [codecReplacement, emptySegmentRemoval]});
            var processed = modifier.process(testdata);
            expect(processed).toContain(codecReplacement.replacement);
            expect(processed).not.toContain(emptySegmentToBeRemoved);
            expect(isValidXml(processed)).toBe(true);
        })
        
        //it('applies the offset of the first video segment as the presentationTimeOffset, with the representation\'s timescale', function() {
        //    var modifier = new shaka.vimond.dash.ManifestTextPreprocessor({presentationTimeOffsetFixPolicy: 'firstVideo'});
        //    var processed = modifier.process(testdata);
        //    
        //});
    });
});